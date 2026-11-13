// The profile store (C62c, SP4.3a spec 4): the bridge's owner of the persons (files under `<data dir>/drivers/`, the
// source of truth) and of the profile store (`<data dir>/profiles.sqlite`, a cache). It applies the driver-profile
// uiActions, rejecting an invalid one with a reason (C73); runs the units' declared profile entries over each person's
// linked stored sessions (C34), for the frames of the slot's `human` car-driver spans only; hands a run its profile
// snapshot at session start; and publishes `drivers.profiles` and `drivers.links` itself (C54, C55). The running bridge
// is its only writer while it runs (`drivers/.lock`). A stale stored session it reads (C61) is skipped, and its rebuild
// requested once; once that settles, the store recomputes.
import { join } from 'node:path';
import { canonicalJson, type TopicName } from '@pitwall/contracts';
import { known, unknown, type CarId, type DriverPerson, type Known, type DriverProfile, type ProfileEntry, type PersonId, type ProfileSnapshot, type SessionRef, type TeamId, type UnlinkedSlot, type DriversLinksValue, type FeedId, type LiveSeat, type LinkedSession as PersonSession } from '@pitwall/domain';
import type { FeatureConfig } from '../feature-config.ts';
import type { Feature } from '../features/feature.ts';
import type { ValueFor } from '../hub/topic-hub.ts';
import type { Logger } from '../log.ts';
import type { SessionKey } from '../storage/db.ts';
import type { DriverSessionRow, DriverSessions } from '../storage/weekend-repository.ts';
import { ProfileRunner, ProfilesCache, sha256, type LinkedSession } from './compute.ts';
import { humanLapCount, linkMatches, newestFirst, personOf, seatLinks, storedSlots, unlinkedSlots, type StoredSlot } from './links.ts';
import { loadPersons, sameSession, takeLock, writePerson } from './persons.ts';
import { checkAction } from './validate.ts';

export type { DriverAction } from '@pitwall/contracts';
export { isDriverAction } from './validate.ts';
import type { DriverAction } from '@pitwall/contracts';

/** The answer to a driver-profile uiAction (C73): a rejection carries its reason and changes nothing. */
export type ApplyResult = { ok: true } | { ok: false; reason: 'invalid'; message: string };

/**
 * A car slot of a session as Participants names it: its car id, team, race number and the name the game gave it
 * (`null` when hidden online). A run's slots at session start, for `snapshotFor`.
 */
export type SlotIdentity = { carId: CarId; teamId: number; raceNumber: number; name: string | null };

/** One linked session of a person with its own value of each entry: the entry's aggregate over that one session. */
export type DriverSessionValues = { session: SessionRef; date: string; entries: Record<string, Known<number>> };

export type ProfileStoreDeps = {
  /** The features whose `profiles` declarations the store runs (C63). */
  features: readonly Feature[];
  /** The stored sessions the links apply to (C34, C61). */
  repo: DriverSessions;
  /** The effective config (C47): the profile aggregates read the units' thresholds from it. */
  config: FeatureConfig;
  hub: { publishGlobal(topic: TopicName, valueFor: ValueFor): void };
  log: Logger;
  /**
   * Rebuilds stored sessions from their recordings (C61). The store asks once per session it read stale and recomputes
   * once the rebuild settles; a rejection is logged and the session stays skipped.
   */
  rebuild: (keys: readonly SessionKey[]) => Promise<void>;
  /** Now as an ISO date. Default: the wall clock. */
  now?: () => string;
};

const OK: ApplyResult = { ok: true };
const keyText = (s: SessionKey): string => `${s.sessionUid}/${s.weekendId}/${s.playerCar}`;
const byId = (a: DriverPerson, b: DriverPerson): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The session's laps (ruling R17) when its stored settings carry them; storage keeps no other record of them. */
const totalLapsOf = (row: DriverSessionRow): Known<number> => {
  const laps = row.settings['totalLaps'];
  return typeof laps === 'number' ? known(laps, 0) : unknown('notReceived');
};

/** A linked slot as the aggregates read it (`StoredDriverSession`); `undefined` for a stale session's (C61). */
function linkedSession(slot: StoredSlot): LinkedSession | undefined {
  const { row } = slot;
  if (row.stale) return undefined;
  return {
    rulesVersion: row.rulesVersion,
    stored: {
      session: slot.session, carId: slot.carId, startedAt: row.startedAt, phase: row.phase, aiDifficulty: row.aiDifficulty,
      totalLaps: totalLapsOf(row), projection: row.projection, humanSpans: slot.humanSpans, track: row.track,
    },
  };
}

export class ProfileStore {
  readonly #root: string;
  readonly #deps: ProfileStoreDeps;
  readonly #cache: ProfilesCache;
  readonly #runner: ProfileRunner;
  readonly #release: () => void;
  /** Every person in id order, as their files hold them. */
  #persons: DriverPerson[] = [];
  readonly #entries = new Map<string, Record<string, ProfileEntry>>();
  /** Every slot of the stored sessions as last read. */
  #slots: StoredSlot[] = [];
  #unlinked: UnlinkedSlot[] = [];
  /** The stale sessions whose rebuild was requested (`keyText`): never requested again in this run. */
  readonly #rebuildRequested = new Set<string>();
  /** Each running feed's human seats as it last told them (`feedSeats`). */
  readonly #feedSeats = new Map<FeedId, readonly Omit<LiveSeat, 'feedId'>[]>();
  /** `unlinkedSeats` as last published, as JSON: a seat report publishes only when it changes. */
  #publishedSeats = '[]';
  #closed = false;

  private constructor(root: string, deps: ProfileStoreDeps, release: () => void) {
    this.#root = root;
    this.#deps = deps;
    this.#release = release;
    this.#cache = new ProfilesCache(join(root, 'profiles.sqlite'));
    this.#runner = new ProfileRunner(deps.features.flatMap((f) => f.profiles ?? []), this.#cache, deps.config, deps.log);
  }

  /**
   * Takes the lock `drivers/.lock` under `dataDir`, loads the persons, computes their entries (from the cache where it
   * is current) and publishes the topics. Throws, naming the lock, when another process holds it.
   */
  static open(dataDir: string, deps: ProfileStoreDeps): ProfileStore {
    const release = takeLock(dataDir);
    let store: ProfileStore | undefined;
    try {
      store = new ProfileStore(dataDir, deps, release);
      store.#persons = loadPersons(dataDir, deps.log).toSorted(byId);
      store.#recomputeAll();
      store.#publishAll();
      return store;
    } catch (error) {
      if (store === undefined) release();
      else store.close();
      throw error;
    }
  }

  /** Applies one driver-profile uiAction; an invalid one is rejected with a reason and changes nothing (C73). */
  apply(action: DriverAction): ApplyResult {
    const checked = checkAction(action, {
      persons: new Map(this.#persons.map((p) => [p.id, p])),
      slots: this.#slots,
      unlinked: this.#unlinked,
      entry: (key) => this.#runner.entryDecl(key),
    });
    if (!checked.ok) return { ok: false, reason: 'invalid', message: checked.message };
    for (const person of checked.write) {
      writePerson(this.#root, person);
      this.#persons = [...this.#persons.filter((p) => p.id !== person.id), person].toSorted(byId);
    }
    this.#recomputeAll();
    this.#publishAll();
    return OK;
  }

  /** Links the seat (team and race number) to `person`, moving it from any other; `null` unlinks it (`drivers.link`). */
  linkSeat(team: TeamId, raceNumber: number, person: PersonId | null): ApplyResult {
    return this.apply({ kind: 'drivers.link', team, raceNumber, person });
  }

  /**
   * The run's profile snapshot at session start (C62c): the persons' files read again, every seat link applied to the
   * session's slots by team and race number (`bySlot`, `null` for an unlinked one) and the linked persons' profiles.
   * The session does not change the match (a seat is the same in every session).
   */
  snapshotFor(slots: readonly SlotIdentity[], _session: SessionRef): ProfileSnapshot {
    this.#reloadPersons();
    const bySlot: (string | null)[] = Array.from({ length: slots.reduce((n, s) => Math.max(n, s.carId + 1), 0) }, () => null);
    const profiles: Record<string, DriverProfile> = {};
    for (const slot of slots) {
      const person = personOf(this.#persons, slot);
      if (person === undefined) continue;
      bySlot[slot.carId] = person.id;
      profiles[person.id] = { person: person.id, displayName: person.displayName, entries: this.#entries.get(person.id) ?? {} };
    }
    return { fingerprint: sha256(canonicalJson({ bySlot, profiles })), bySlot, profiles };
  }

  /**
   * A running feed's human seats now (its player car and teammate while their `car-driver` span is `human`, with their
   * team and race number from Participants); `[]` once the feed stops. The ones without a link are `drivers.links`'s
   * `unlinkedSeats`, published when they change (SP4.3b2 Task 10).
   */
  feedSeats(feedId: FeedId, seats: readonly Omit<LiveSeat, 'feedId'>[]): void {
    if (seats.length === 0) this.#feedSeats.delete(feedId);
    else this.#feedSeats.set(feedId, seats.map((s) => ({ ...s })));
    if (JSON.stringify(this.#unlinkedSeats()) !== this.#publishedSeats) this.#publishLinks();
  }

  /** The slots of the stored sessions with a `human` span and no confirmed link, newest session first, with their suggestions. */
  unlinked(): UnlinkedSlot[] {
    return this.#unlinked;
  }

  /**
   * The person's linked sessions (those their profile rests on: a `human` span, not excluded, not stale), oldest first,
   * each with its own value of every entry (`pitwall drivers show`). Empty for an unknown person.
   */
  sessionValues(person: PersonId): DriverSessionValues[] {
    const found = this.#persons.find((p) => p.id === person);
    if (found === undefined) return [];
    return this.#linkedSessions(found)
      .toSorted((a, b) => (a.stored.startedAt < b.stored.startedAt ? -1 : a.stored.startedAt > b.stored.startedAt ? 1 : 0))
      .map((s) => ({ session: s.stored.session, date: s.stored.startedAt.slice(0, 10), entries: this.#runner.sessionValues(s) }));
  }

  /** Recomputes every person's entries and the unlinked slots: on an edit, at session end, after a rebuild (C61). */
  recompute(trigger: 'edit' | 'sessionEnd' | 'rebuild'): void {
    this.#deps.log.debug({ trigger }, 'driver profiles recompute');
    this.#recomputeAll();
    this.#publishAll();
  }

  /** Closes the cache and releases the lock. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cache.close();
    this.#release();
  }

  /** The person files read again (C62c: at every session start); a change made beside the store is computed and published. */
  #reloadPersons(): void {
    const persons = loadPersons(this.#root, this.#deps.log).toSorted(byId);
    if (JSON.stringify(persons) === JSON.stringify(this.#persons)) return;
    this.#persons = persons;
    this.#recomputeAll();
    this.#publishAll();
  }

  #recomputeAll(): void {
    const rows = this.#deps.repo.driverSessions();
    this.#slots = rows.flatMap(storedSlots);
    this.#entries.clear();
    for (const person of this.#persons) this.#entries.set(person.id, this.#runner.entries(person, this.#linkedSessions(person)));
    this.#unlinked = unlinkedSlots(this.#slots, this.#persons);
    // The links and the suggestions read every stored session: a stale one awaits its rebuild.
    this.#requestRebuild(rows.filter((r) => r.stale));
  }

  /** The person's linked, not excluded slots with a `human` span, of the sessions that are not stale (C61). */
  #linkedSessions(person: DriverPerson): LinkedSession[] {
    return this.#slots
      .filter((slot) => slot.humanSpans.length > 0 && person.links.some((l) => linkMatches(l, slot)) && !person.excluded.some((e) => sameSession(e, slot.session)))
      .flatMap((slot) => linkedSession(slot) ?? []);
  }

  /** Asks for the rebuild of the stale sessions not asked for yet (C61), then recomputes; a failure is logged, never thrown. */
  #requestRebuild(stale: readonly DriverSessionRow[]): void {
    const keys = stale
      .filter((s) => !this.#rebuildRequested.has(keyText(s)))
      .map((s): SessionKey => ({ sessionUid: s.sessionUid, weekendId: s.weekendId, playerCar: s.playerCar }));
    if (keys.length === 0) return;
    for (const key of keys) this.#rebuildRequested.add(keyText(key));
    const { log } = this.#deps;
    (async () => this.#deps.rebuild(keys))()
      .then(
        () => {
          if (!this.#closed) this.recompute('rebuild');
        },
        (error: unknown) => {
          log.error({ err: error, sessions: keys.map(keyText) }, 'stored sessions not rebuilt: they stay out of the driver profiles');
        },
      )
      .catch((error: unknown) => {
        log.error({ err: error }, 'driver profiles recompute after a rebuild failed');
      });
  }

  /**
   * Every stored session a seat of the person drove with a `human` span (C17, C62c), newest first: its date, track and
   * weekend phase (the stored weekend-phase span's, C20), the person's laps in it and whether the user excluded it.
   */
  #sessionsOf(person: DriverPerson): PersonSession[] {
    return this.#slots
      .filter((slot) => slot.humanSpans.length > 0 && person.links.some((l) => linkMatches(l, slot)))
      .toSorted(newestFirst)
      .flatMap((slot): PersonSession[] => {
        const { row } = slot;
        if (row.stale) return [];
        return [{
          session: slot.session, date: row.startedAt, trackId: row.trackId, phase: row.phase, laps: humanLapCount(slot),
          excluded: person.excluded.some((e) => sameSession(e, slot.session)),
        }];
      });
  }

  /** The running feeds' human seats whose seat no person links (C62c), feed by feed. */
  #unlinkedSeats(): LiveSeat[] {
    return [...this.#feedSeats].flatMap(([feedId, seats]) =>
      seats.filter((s) => personOf(this.#persons, { teamId: s.team, raceNumber: s.raceNumber }) === undefined).map((s) => ({ feedId, ...s })));
  }

  #publishLinks(): void {
    const unlinkedSeats = this.#unlinkedSeats();
    this.#publishedSeats = JSON.stringify(unlinkedSeats);
    const value: DriversLinksValue = { links: seatLinks(this.#persons), unlinked: this.#unlinked, unlinkedSeats };
    this.#deps.hub.publishGlobal('drivers.links', () => value);
  }

  #publishAll(): void {
    const persons = this.#persons.map((p) => {
      const sessions = this.#sessionsOf(p);
      const kept = sessions.filter((s) => !s.excluded);
      return {
        person: p.id, displayName: p.displayName, entries: this.#entries.get(p.id) ?? {}, links: p.links, excluded: p.excluded,
        sessions, kept: { sessions: kept.length, laps: kept.reduce((n, s) => n + s.laps, 0) },
      };
    });
    this.#deps.hub.publishGlobal('drivers.profiles', () => ({ persons }));
    this.#publishLinks();
  }
}
