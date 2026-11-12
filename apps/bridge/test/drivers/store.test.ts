// The profile store (SP4.3a Task 6; C3, C32, C34, C54, C55, C61, C62c, C73, C84; spec 4): the bridge owns the persons
// (files `drivers/<person>.json`, the source of truth) and the profile store (`profiles.sqlite`, a cache: deleting it
// loses nothing). It validates every driver-profile uiAction and rejects an invalid one with a reason (C73), applies a
// confirmed link to every stored slot it names (by name and race number, or one slot), runs the units' declared profile
// entries over each person's linked sessions for the frames of the slot's `human` car-driver spans only (the units
// judge, C43), suggests a person for an unlinked human slot (a hint, never applied without `link` or `accept`) and
// publishes `drivers.profiles` and `drivers.links` itself (C54, C55). Every test owns a temporary data dir and a fake read
// of the stored sessions (C84): no real storage, no profile store of the user.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import {
  carDriverSpans, carId, known, unknown,
  type CarId, type DriverPerson, type DriversLinksValue, type DriversProfilesValue, type Known, type ProfileEntry, type SessionRef,
  type SessionUid, type Span,
} from '@pitwall/domain';
import { defineProfiles, type ProfileCtx, type ProjectionState, type StoredDriverSession } from '@pitwall/engine/readers';
import { history, lap as builtLap } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { ProfileStore, type DriverAction, type SlotIdentity } from '../../src/drivers/store.ts';
import type { Feature } from '../../src/features/feature.ts';
import type { ValueFor } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import type { SessionKey } from '../../src/storage/db.ts';
import type { DriverSessionRow, DriverSessions } from '../../src/storage/weekend-repository.ts';
import { lap, span } from '../storage/records.ts';

const TRACK = 10;
const MERCEDES = 0;
const FERRARI = 1;
const CAR_DRIVER = carDriverSpans.machine;
const car = (n: number): CarId => n as CarId;
const day = (d: number): string => `2026-10-${String(d).padStart(2, '0')}T20:00:00.000Z`;
/** A lap of car `c` describes frame `10 * lapNumber` (C26): its frames tell which car-driver span it lies in. */
const frameOf = (lapNumber: number): number => 10 * lapNumber;

// --- fake stored sessions -------------------------------------------------------------------------------------------

/**
 * One car slot of a stored session: its team, race number and name (`null`: hidden online), its laps (default 5, each
 * `90_000 + lap` ms) and who drives it: `human` (default) or `ai` for the whole session, or a human until lap
 * `humanUntilLap`, the AI after it (a takeover).
 */
type SlotSpec = { car: number; team: number; number: number; name: string | null; laps?: number; driver?: 'human' | 'ai' | { humanUntilLap: number } };

/** The car-driver spans of a slot: frames `[0, end)` split at a takeover, as the sub-machine closes them (C26). */
function driverSpans(s: SlotSpec): Span[] {
  const end = frameOf((s.laps ?? 5) + 1);
  const at = (kind: string, id: number, startFrame: number, endFrame: number) =>
    span(CAR_DRIVER, kind, { id, carId: car(s.car), startFrame, endFrame, start: startFrame * 100, end: endFrame * 100 });
  const driver = s.driver ?? 'human';
  if (driver === 'human' || driver === 'ai') return [at(driver, 0, 0, end)];
  const flip = frameOf(driver.humanUntilLap) + 5;
  return [at('human', 0, 0, flip), at('ai', 1, flip, end)];
}

/**
 * A complete stored session of the feed whose player is car 0 (weekend `W1`, track `TRACK` unless told), with the
 * slots given; `stale`: stored under another rules version (`staleOf`); `rulesVersion` (default `current`) as storage
 * recorded it.
 */
function driverSession(uid: string, o: { startedAt: string; slots: SlotSpec[]; weekendId?: string; trackId?: number; stale?: boolean; rulesVersion?: string }): DriverSessionRow {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const projection: ProjectionState = {
    laps: o.slots.flatMap((s) => range(s.laps ?? 5).map((n) => lap(s.car, n, { lapTimeMs: 90_000 + n, frame: frameOf(n) }))),
    stints: [], pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [],
    spans: { [CAR_DRIVER]: o.slots.flatMap(driverSpans) }, appendedAt: {},
  };
  const row: DriverSessionRow = {
    sessionUid: uid as SessionUid, weekendId: o.weekendId ?? 'W1', seasonId: 'S1', playerCar: car(0), teammateCar: null,
    trackId: o.trackId ?? TRACK, startedAt: o.startedAt, pwrecPath: null, settings: { aiDifficulty: 90 },
    cars: o.slots.map((s) => ({ carId: car(s.car), carKey: { teamId: s.team, raceNumber: s.number }, driver: s.name === null ? unknown('notReceived') : known(s.name, 0) })),
    rulesVersion: o.rulesVersion ?? 'current', complete: true, track: unknown('notApplicable'), aiDifficulty: known(90, 0),
    stale: false, phase: { kind: 'race', format: 'grandPrix' }, projection,
  };
  return o.stale === true ? staleOf(row) : row;
}

/** `s` as stored under another rules version: it awaits its rebuild (C61), so it comes without its projection or phase. */
function staleOf(s: DriverSessionRow): DriverSessionRow {
  return {
    sessionUid: s.sessionUid, weekendId: s.weekendId, seasonId: s.seasonId, playerCar: s.playerCar, teammateCar: s.teammateCar, trackId: s.trackId,
    startedAt: s.startedAt, pwrecPath: s.pwrecPath, settings: s.settings, cars: s.cars, rulesVersion: 'old', complete: s.complete, track: s.track,
    aiDifficulty: s.aiDifficulty, stale: true, projection: undefined,
  };
}

/** A fake read of the stored sessions; `sessions` may be replaced to stand for a rebuild or a new session. */
function fakeRepo(sessions: DriverSessionRow[]): { sessions: DriverSessionRow[]; repo: DriverSessions } {
  const state = { sessions, repo: undefined as unknown as DriverSessions };
  state.repo = { driverSessions: () => state.sessions };
  return state;
}

/** The stored session `s` as a driver-profile action names it (C60's key). */
const ref = (s: Pick<DriverSessionRow, 'sessionUid' | 'weekendId' | 'playerCar'>): SessionRef => ({ sessionUid: s.sessionUid, weekendId: s.weekendId, feedCar: s.playerCar });
/** The seat (team and race number) of slot `carNumber` of `s`, as `drivers.link` names it (SP4.3b Task 2). */
const seat = (s: DriverSessionRow, carNumber: number): { team: number; raceNumber: number } => {
  const key = s.cars.find((c) => c.carId === car(carNumber))?.carKey;
  return { team: key?.teamId ?? -1, raceNumber: key?.raceNumber ?? -1 };
};
/** The slots of `s` as a run starting on it gives them to `snapshotFor`. */
const slotsOf = (s: DriverSessionRow): SlotIdentity[] =>
  s.cars.map((c) => ({ carId: c.carId, teamId: c.carKey.teamId, raceNumber: c.carKey.raceNumber, name: c.driver.known ? c.driver.value : null }));
const slotText = (s: StoredDriverSession): string => `${s.session.sessionUid}/${s.carId}`;

// --- fake features --------------------------------------------------------------------------------------------------

/** The laps of the session's linked car whose described frame lies in one of the given human spans (C26). */
const humanLaps = (s: StoredDriverSession) =>
  s.projection.laps.filter((l) => l.carId === s.carId && s.humanSpans.some((h) => l.frame >= h.startFrame && (h.endFrame === undefined || l.frame < h.endFrame)));
const weightOf = (ctx: ProfileCtx): number => Number(ctx.config['fake']?.['weight'] ?? 1);

/**
 * One unit `fake` with two profile entries: `fake.lapCount` (the human laps times the config's `fake.weight`, range
 * [0, 10 000]) and `fake.meanLapMs` (their mean lap time, range [60 000, 200 000]). The entries judge which laps count
 * (from `humanSpans`), not the store. Every aggregate call's sessions are recorded.
 */
function fakeFeatures(o: { countVersion?: number } = {}) {
  const calls = { count: [] as StoredDriverSession[][], mean: [] as StoredDriverSession[][] };
  const decl = defineProfiles('fake', {
    entries: {
      'fake.lapCount': {
        version: o.countVersion ?? 1, range: [0, 10_000],
        aggregate: (sessions, ctx) => {
          calls.count.push([...sessions]);
          const laps = sessions.reduce((n, s) => n + humanLaps(s).length, 0);
          return { value: known(laps * weightOf(ctx), 0), laps };
        },
      },
      'fake.meanLapMs': {
        version: 1, range: [60_000, 200_000],
        aggregate: (sessions) => {
          calls.mean.push([...sessions]);
          const laps = sessions.flatMap(humanLaps);
          const value: Known<number> = laps.length === 0 ? unknown('insufficientData') : known(Math.round(laps.reduce((sum, l) => sum + l.lapTimeMs, 0) / laps.length), 0);
          return { value, laps: laps.length };
        },
      },
    },
  });
  const features: Feature[] = [{ name: 'fake', calculators: [], topics: [], profiles: [decl] }];
  return { features, calls };
}

/** The aggregate calls that received at least one session: a person's own computation. */
const withSessions = (calls: StoredDriverSession[][]): StoredDriverSession[][] => calls.filter((c) => c.length > 0);

// --- the store under test -------------------------------------------------------------------------------------------

/** What the store published, in order, each value read at the time of publishing. */
function fakeHub() {
  const published: Array<{ topic: TopicName; value: unknown }> = [];
  const hub = { publishGlobal: (topic: TopicName, valueFor: ValueFor) => { published.push({ topic, value: valueFor({}) }); } };
  const count = (topic: string) => published.filter((p) => p.topic === topic).length;
  const last = <T>(topic: string): T => published.filter((p) => p.topic === topic).at(-1)?.value as T;
  return { hub, published, count, last };
}

const opened = new Set<ProfileStore>();
afterEach(() => { for (const store of opened) store.close(); opened.clear(); });

type Rebuild = (keys: readonly SessionKey[]) => Promise<void>;
type Setup = {
  sessions: DriverSessionRow[]; dir?: string; features?: ReturnType<typeof fakeFeatures>; config?: Record<string, Record<string, number>>;
  /** The rebuild the store asks for (C61); by default one that stays pending, so a stale session stays stale. */
  rebuild?: Rebuild;
};

function setup({
  sessions, dir = mkdtempSync(join(tmpdir(), 'profiles-')), features = fakeFeatures(), config = { fake: { weight: 1 } },
  rebuild = vi.fn<Rebuild>(() => new Promise<void>(() => {})),
}: Setup) {
  const repo = fakeRepo(sessions);
  const h = fakeHub();
  const store = ProfileStore.open(dir, { features: features.features, repo: repo.repo, config, hub: h.hub, log: createLogger({ level: 'silent' }), rebuild });
  opened.add(store);
  const close = () => { store.close(); opened.delete(store); };
  const apply = (action: DriverAction) => store.apply(action);
  const ok = (action: DriverAction) => expect(store.apply(action)).toEqual({ ok: true });
  const persons = () => h.last<DriversProfilesValue>('drivers.profiles').persons;
  /** The person's entry as `drivers.profiles` last published it. */
  const entry = (person: string, key: string): ProfileEntry | undefined => persons().find((p) => p.person === person)?.entries[key];
  /** Adds the person and links it to the slot `carId` of `s`. */
  const addAndLink = (person: string, displayName: string, s: DriverSessionRow, carNumber: number) => {
    ok({ kind: 'drivers.add', person, displayName });
    ok({ kind: 'drivers.link', ...seat(s, carNumber), person });
  };
  return { dir, store, repo, features, ...h, close, apply, ok, persons, entry, addAndLink };
}

const personPath = (dir: string, person: string) => join(dir, 'drivers', `${person}.json`);
const readPerson = (dir: string, person: string): DriverPerson => JSON.parse(readFileSync(personPath(dir, person), 'utf8')) as DriverPerson;
/** Every file under `drivers/` with its content, the lock left out. */
const driverFiles = (dir: string): Record<string, string> => {
  const root = join(dir, 'drivers');
  if (!existsSync(root)) return {};
  return Object.fromEntries(readdirSync(root).filter((name) => name.endsWith('.json')).map((name) => [name, readFileSync(join(root, name), 'utf8')]));
};
const valueOf = (entry: ProfileEntry | undefined): number | undefined => (entry?.value.known === true ? entry.value.value : undefined);
const mean = (values: number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
const unlinkedKeys = (store: ProfileStore) => store.unlinked().map((u) => `${u.session.sessionUid}/${u.carId}`);
/** Lets every settled promise's callbacks run. */
const settle = () => new Promise<void>((resolve) => { setImmediate(resolve); });

const HOST: SlotSpec = { car: 0, team: 5, number: 22, name: 'Host' };

// --- the tests ------------------------------------------------------------------------------------------------------

describe('ProfileStore', () => {
  it('add writes the person file; link by name and number applies to every matching slot', () => {
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, { car: 2, team: MERCEDES, number: 7, name: 'Anna R' }] });
    const s2 = driverSession('2', { startedAt: day(2), slots: [HOST, { car: 5, team: MERCEDES, number: 7, name: 'Anna R' }] });
    // Another weekend, another track and team: the same name and race number is the same person (C62c).
    const s3 = driverSession('3', { startedAt: day(3), weekendId: 'W2', trackId: 11, slots: [HOST, { car: 3, team: 4, number: 7, name: 'Anna R' }] });
    // The same name on another race number is not the link's.
    const s4 = driverSession('4', { startedAt: day(4), slots: [HOST, { car: 2, team: MERCEDES, number: 8, name: 'Anna R' }] });
    const t = setup({ sessions: [s1, s2, s3, s4] });

    t.ok({ kind: 'drivers.add', person: 'anna', displayName: 'Anna' });
    expect(readPerson(t.dir, 'anna')).toEqual({ id: 'anna', displayName: 'Anna', links: [], excluded: [], overrides: {} });

    t.ok({ kind: 'drivers.link', ...seat(s1, 2), person: 'anna' });
    expect(readPerson(t.dir, 'anna').links).toEqual([{ kind: 'nameAndNumber', name: 'Anna R', raceNumber: 7 }]);
    // The three sessions' slots are the person's: the entries rest on them, and none is listed unlinked.
    const last = withSessions(t.features.calls.count).at(-1) ?? [];
    expect(last.map(slotText).toSorted()).toEqual(['1/2', '2/5', '3/3']);
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ value: { known: true, value: 15 }, laps: 15, sessions: 3, newestSession: day(3) });
    expect(unlinkedKeys(t.store)).not.toContain('1/2');
    expect(unlinkedKeys(t.store)).not.toContain('2/5');
    expect(unlinkedKeys(t.store)).not.toContain('3/3');
    expect(unlinkedKeys(t.store)).toContain('4/2');

    // A new session's slot with that name and race number is linked at its start.
    const next = driverSession('5', { startedAt: day(5), slots: [HOST, { car: 6, team: MERCEDES, number: 7, name: 'Anna R' }] });
    const snapshot = t.store.snapshotFor(slotsOf(next), ref(next));
    expect(snapshot.bySlot[6]).toBe('anna');
    expect(snapshot.bySlot[0]).toBeNull();
    expect(snapshot.profiles['anna']).toMatchObject({ person: 'anna', displayName: 'Anna' });
    expect(snapshot.profiles['anna']?.entries['fake.lapCount']).toEqual(t.entry('anna', 'fake.lapCount'));
  });

  it('entries aggregate only the human spans\' laps; an excluded session drops out', () => {
    const anna = (c: number, o: Partial<SlotSpec> = {}): SlotSpec => ({ car: c, team: MERCEDES, number: 7, name: 'Anna R', ...o });
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, anna(2)] });
    // The AI drove the slot all session: no frame of it counts (C62c, C17).
    const s2 = driverSession('2', { startedAt: day(2), slots: [HOST, anna(2, { driver: 'ai' })] });
    const s3 = driverSession('3', { startedAt: day(3), slots: [HOST, anna(4, { laps: 4 })] });
    const t = setup({ sessions: [s1, s2, s3] });
    t.addAndLink('anna', 'Anna', s1, 2);

    // The aggregate receives each linked slot with the frames of its human spans.
    const given = withSessions(t.features.calls.count).at(-1) ?? [];
    const humanSpansOf = (text: string) => given.find((s) => slotText(s) === text)?.humanSpans.map((h) => [h.startFrame, h.endFrame]);
    expect(humanSpansOf('1/2')).toEqual([[0, frameOf(6)]]);
    expect(humanSpansOf('3/4')).toEqual([[0, frameOf(5)]]);
    expect(given.filter((s) => slotText(s) === '2/2').flatMap((s) => s.humanSpans)).toEqual([]);
    expect(given.find((s) => slotText(s) === '1/2')).toMatchObject({ session: ref(s1), startedAt: day(1), phase: { kind: 'race' }, aiDifficulty: { known: true, value: 90 } });
    // Laps and sessions count only the human part: s2's AI laps and s2 itself are left out.
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ value: { known: true, value: 9 }, laps: 9, sessions: 2 });

    t.ok({ kind: 'drivers.exclude', person: 'anna', session: ref(s1) });
    expect(readPerson(t.dir, 'anna').excluded).toEqual([ref(s1)]);
    const after = withSessions(t.features.calls.count).at(-1) ?? [];
    expect(after.map((s) => s.session.sessionUid)).not.toContain('1');
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ value: { known: true, value: 4 }, laps: 4, sessions: 1, newestSession: day(3) });
  });

  it('cache: a version, fingerprint or config change recomputes; deleting profiles.sqlite loses nothing', () => {
    const anna: SlotSpec = { car: 2, team: MERCEDES, number: 7, name: 'Anna R' };
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, anna] });
    const s2 = driverSession('2', { startedAt: day(2), slots: [HOST, { ...anna, laps: 3 }] });
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    const first = setup({ sessions: [s1, s2], dir });
    first.addAndLink('anna', 'Anna', s1, 2);
    const computed = first.persons();
    expect(existsSync(join(dir, 'profiles.sqlite'))).toBe(true);
    first.close();

    // The same versions, links, sessions and config: nothing is computed again.
    const same = setup({ sessions: [s1, s2], dir });
    expect(same.persons()).toEqual(computed);
    expect(withSessions(same.features.calls.count)).toEqual([]);
    expect(withSessions(same.features.calls.mean)).toEqual([]);
    same.close();

    // A new version of one entry recomputes that entry only.
    const bumped = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ countVersion: 2 }) });
    expect(bumped.persons()).toEqual(computed);
    expect(withSessions(bumped.features.calls.count).length).toBeGreaterThan(0);
    expect(withSessions(bumped.features.calls.mean)).toEqual([]);
    bumped.close();

    // Another config is another fingerprint.
    const reconfigured = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ countVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(valueOf(reconfigured.entry('anna', 'fake.lapCount'))).toBe(16);
    expect(withSessions(reconfigured.features.calls.count).length).toBeGreaterThan(0);
    reconfigured.close();

    // A linked session rebuilt under another rules version is another fingerprint (C61).
    const rebuilt = setup({ sessions: [s1, { ...s2, rulesVersion: 'next' }], dir, features: fakeFeatures({ countVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(withSessions(rebuilt.features.calls.count).length).toBeGreaterThan(0);
    expect(withSessions(rebuilt.features.calls.mean).length).toBeGreaterThan(0);

    // An exclusion is another fingerprint.
    const before = withSessions(rebuilt.features.calls.count).length;
    rebuilt.ok({ kind: 'drivers.exclude', person: 'anna', session: ref(s2) });
    expect(withSessions(rebuilt.features.calls.count).length).toBeGreaterThan(before);
    const edited = rebuilt.persons();
    expect(valueOf(rebuilt.entry('anna', 'fake.lapCount'))).toBe(10);
    rebuilt.close();

    // The cache deleted: the entries are computed again from the person files, equal.
    for (const file of ['profiles.sqlite', 'profiles.sqlite-wal', 'profiles.sqlite-shm']) rmSync(join(dir, file), { force: true });
    const fresh = setup({ sessions: [s1, { ...s2, rulesVersion: 'next' }], dir, features: fakeFeatures({ countVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(fresh.persons()).toEqual(edited);
    expect(withSessions(fresh.features.calls.count).length).toBeGreaterThan(0);
  });

  // SP4.3a final review F5 (C62c): the aggregates read each linked session's track file (`StoredDriverSession.track`),
  // so its content is an input of the fingerprint: a changed file recomputes, the same content does not.
  it("cache: a linked session's track file is an input of the fingerprint (its content)", () => {
    const anna: SlotSpec = { car: 2, team: MERCEDES, number: 7, name: 'Anna R' };
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, anna] });
    const s2 = driverSession('2', { startedAt: day(2), slots: [HOST, { ...anna, laps: 3 }] });
    const zandvoort = zandvoortTrack();
    const withTrack = (s: DriverSessionRow, track: DriverSessionRow['track']): DriverSessionRow => ({ ...s, track });
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    const first = setup({ sessions: [s1, withTrack(s2, known(zandvoort, 0))], dir });
    first.addAndLink('anna', 'Anna', s1, 2);
    first.close();

    // The same track content (another copy of it): nothing is computed again.
    const same = setup({ sessions: [s1, withTrack(s2, known(structuredClone(zandvoort), 0))], dir });
    expect(withSessions(same.features.calls.count)).toEqual([]);
    expect(withSessions(same.features.calls.mean)).toEqual([]);
    same.close();

    // The track file of a linked session changed (another pit loss): every entry is computed again.
    const edited = { ...structuredClone(zandvoort), name: `${zandvoort.name} (edited)` };
    const green = edited.defaults.pitLossMs.green;
    if (green.known) edited.defaults.pitLossMs.green = { ...green, value: { ...green.value, value: green.value.value + 1_000 } };
    const changed = setup({ sessions: [s1, withTrack(s2, known(edited, 0))], dir });
    expect(withSessions(changed.features.calls.count).length).toBeGreaterThan(0);
    expect(withSessions(changed.features.calls.mean).length).toBeGreaterThan(0);
    changed.close();

    // No track file any more (`notApplicable`): another fingerprint too.
    const without = setup({ sessions: [s1, withTrack(s2, unknown('notApplicable'))], dir });
    expect(withSessions(without.features.calls.count).length).toBeGreaterThan(0);
  });

  it('a slot without a name is linked by slot only', () => {
    const hidden: SlotSpec = { car: 4, team: FERRARI, number: 9, name: null };
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, hidden, { car: 6, team: FERRARI, number: 9, name: 'Ben K' }] });
    const s2 = driverSession('2', { startedAt: day(2), slots: [HOST, hidden] });
    const t = setup({ sessions: [s1, s2] });

    // A name-and-number link never matches a slot without a name, whatever its race number.
    t.addAndLink('ben', 'Ben', s1, 6);
    expect(readPerson(t.dir, 'ben').links).toEqual([{ kind: 'nameAndNumber', name: 'Ben K', raceNumber: 9 }]);
    expect(unlinkedKeys(t.store)).toEqual(expect.arrayContaining(['1/4', '2/4']));

    t.addAndLink('anna', 'Anna', s1, 4);
    expect(readPerson(t.dir, 'anna').links).toEqual([{ kind: 'slot', session: ref(s1), carId: car(4) }]);
    expect(unlinkedKeys(t.store)).not.toContain('1/4');
    expect(unlinkedKeys(t.store)).toContain('2/4');
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ laps: 5, sessions: 1 });

    // The slot link holds for its one session; another session's nameless slot with the same race number stays unlinked.
    const own = t.store.snapshotFor(slotsOf(s1), ref(s1));
    expect([own.bySlot[4], own.bySlot[6]]).toEqual(['anna', 'ben']);
    expect(t.store.snapshotFor(slotsOf(s2), ref(s2)).bySlot[4]).toBeNull();
    const next = driverSession('3', { startedAt: day(3), slots: [HOST, hidden] });
    expect(t.store.snapshotFor(slotsOf(next), ref(next)).bySlot[4]).toBeNull();
  });

  it('suggestions: race number first, then team; accept links every shown suggestion', () => {
    const s1 = driverSession('1', {
      startedAt: day(1),
      slots: [{ car: 0, team: MERCEDES, number: 7, name: 'Anna R' }, { car: 1, team: FERRARI, number: 16, name: 'Ben K' }],
    });
    const s2 = driverSession('2', {
      startedAt: day(2),
      slots: [
        // Anna's race number on another team: by race number.
        { car: 0, team: 5, number: 7, name: null },
        // Ben's team (of his newest link) on an unknown race number: by team.
        { car: 1, team: FERRARI, number: 99, name: null },
        // Neither: no suggestion.
        { car: 2, team: 3, number: 50, name: 'Zed' },
        // The AI all session: not listed.
        { car: 3, team: 3, number: 60, name: 'Bot', driver: 'ai' },
      ],
    });
    // Ben's race number in Anna's team: the race number wins over the team.
    const s3 = driverSession('3', { startedAt: day(3), slots: [{ car: 0, team: MERCEDES, number: 16, name: null }] });
    const t = setup({ sessions: [s1, s2, s3] });
    t.addAndLink('anna', 'Anna', s1, 0);
    t.addAndLink('ben', 'Ben', s1, 1);

    // Newest session first, then by car id; a suggestion is shown, never applied.
    const shown = t.store.unlinked();
    expect(shown.map((u) => [`${u.session.sessionUid}/${u.carId}`, u.suggestion?.person, u.suggestion?.by])).toEqual([
      ['3/0', 'ben', 'raceNumber'],
      ['2/0', 'anna', 'raceNumber'],
      ['2/1', 'ben', 'team'],
      ['2/2', undefined, undefined],
    ]);
    expect(shown[1]).toMatchObject({ session: ref(s2), date: day(2), trackId: TRACK, carId: car(0), teamId: 5, raceNumber: 7, name: null });
    expect(shown[3]).toMatchObject({ name: 'Zed' });
    expect(shown[3]).not.toHaveProperty('suggestion');
    expect(t.last<DriversLinksValue>('drivers.links')).toEqual({ unlinked: shown });
    expect(readPerson(t.dir, 'anna').links).toHaveLength(1);
    expect(readPerson(t.dir, 'ben').links).toHaveLength(1);

    // Accept links every shown suggestion: a slot without a name by its slot.
    // SP4.3b Task 2: drivers.accept removed.
    expect(readPerson(t.dir, 'anna').links).toEqual([
      { kind: 'nameAndNumber', name: 'Anna R', raceNumber: 7 },
      { kind: 'slot', session: ref(s2), carId: car(0) },
    ]);
    expect(readPerson(t.dir, 'ben').links).toHaveLength(3);
    expect(readPerson(t.dir, 'ben').links).toEqual(expect.arrayContaining([
      { kind: 'nameAndNumber', name: 'Ben K', raceNumber: 16 },
      { kind: 'slot', session: ref(s3), carId: car(0) },
      { kind: 'slot', session: ref(s2), carId: car(1) },
    ]));
    expect(unlinkedKeys(t.store)).toEqual(['2/2']);
    expect(t.last<DriversLinksValue>('drivers.links').unlinked.map((u) => `${u.session.sessionUid}/${u.carId}`)).toEqual(['2/2']);
  });

  it('an invalid override is rejected with a reason and changes nothing', () => {
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, { car: 2, team: MERCEDES, number: 7, name: 'Anna R' }] });
    const t = setup({ sessions: [s1] });
    t.addAndLink('anna', 'Anna', s1, 2);
    const files = driverFiles(t.dir);
    const published = t.published.length;
    const persons = t.persons();

    const invalid: Array<[string, DriverAction]> = [
      ['an override out of its range', { kind: 'drivers.override', person: 'anna', key: 'fake.lapCount', value: 50_000 }],
      ['an override of an undeclared key', { kind: 'drivers.override', person: 'anna', key: 'fake.nothing', value: 1 }],
      ['an override of an unknown person', { kind: 'drivers.override', person: 'nobody', key: 'fake.lapCount', value: 10 }],
    ];
    for (const [what, action] of invalid) {
      const result = t.apply(action);
      expect(result, what).toMatchObject({ ok: false, reason: 'invalid' });
      expect(result.ok === false && typeof result.message === 'string' && result.message.length > 0, what).toBe(true);
    }
    expect(driverFiles(t.dir)).toEqual(files);
    expect(t.published.length).toBe(published);
    expect(t.persons()).toEqual(persons);
    expect(readPerson(t.dir, 'anna').overrides).toEqual({});
  });

  it('a slot that turns AI mid-session contributes only its human laps', () => {
    // Online, the AI takes over car 3 after lap 6 (the human dropped out): frames [0, 65) human, [65, 110) AI.
    const laps = Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
      builtLap({ carId: carId(3), lapNumber: n, lapTimeMs: n <= 6 ? 91_000 + n : 120_000, frame: frameOf(n) }));
    const takeover = { until: frameOf(6) + 5, end: frameOf(11) };
    const spans = [
      span(CAR_DRIVER, 'human', { id: 0, carId: carId(3), startFrame: 0, endFrame: takeover.until }),
      span(CAR_DRIVER, 'ai', { id: 1, carId: carId(3), startFrame: takeover.until, endFrame: takeover.end }),
    ];
    const base = driverSession('1', { startedAt: day(1), slots: [HOST, { car: 3, team: MERCEDES, number: 7, name: 'Anna R' }] });
    const s1: DriverSessionRow = { ...base, stale: false, phase: { kind: 'race', format: 'grandPrix' }, projection: history({ laps, spans: { [CAR_DRIVER]: spans } }) as ProjectionState };
    const t = setup({ sessions: [s1] });
    t.addAndLink('anna', 'Anna', s1, 3);

    const given = withSessions(t.features.calls.mean).at(-1) ?? [];
    expect(given.map((s) => s.humanSpans.map((h) => [h.startFrame, h.endFrame]))).toEqual([[[0, takeover.until]]]);
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ value: { known: true, value: 6 }, laps: 6, sessions: 1 });
    expect(valueOf(t.entry('anna', 'fake.meanLapMs'))).toBe(mean([1, 2, 3, 4, 5, 6].map((n) => 91_000 + n)));
  });

  it('a stale session is skipped and its rebuild requested once', async () => {
    const anna: SlotSpec = { car: 2, team: MERCEDES, number: 7, name: 'Anna R' };
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, anna] });
    const s2 = driverSession('2', { startedAt: day(2), slots: [HOST, { ...anna, laps: 3 }] });
    const pending: Array<() => void> = [];
    const rebuild = vi.fn<Rebuild>(() => new Promise<void>((resolve) => { pending.push(resolve); }));
    const t = setup({ sessions: [s1, staleOf(s2)], rebuild });
    const requested = () => rebuild.mock.calls.flatMap(([keys]) => keys).map((k) => `${k.sessionUid}/${k.weekendId}/${k.playerCar}`);
    t.addAndLink('anna', 'Anna', s1, 2);
    await settle();

    // The stale session awaits its rebuild (C61): its log is never read, so it is no source of the entries.
    expect(requested()).toEqual(['2/W1/0']);
    expect(t.features.calls.count.flat().map((s) => s.session.sessionUid)).not.toContain('2');
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ laps: 5, sessions: 1 });

    // Read again while the rebuild is pending: no second request.
    const recompute = vi.spyOn(t.store, 'recompute');
    t.store.recompute('sessionEnd');
    t.ok({ kind: 'drivers.override', person: 'anna', key: 'fake.meanLapMs', value: 95_000 });
    await settle();
    expect(requested()).toEqual(['2/W1/0']);
    expect(recompute).not.toHaveBeenCalledWith('rebuild');

    // The rebuild finishes: the store recomputes from the rebuilt projection.
    t.repo.sessions = [s1, s2];
    for (const resolve of pending) resolve();
    await vi.waitFor(() => expect(recompute).toHaveBeenCalledWith('rebuild'));
    expect(t.entry('anna', 'fake.lapCount')).toMatchObject({ laps: 8, sessions: 2, newestSession: day(2) });
    expect(requested()).toEqual(['2/W1/0']);
  });

  it('topics are published on every change', () => {
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST, { car: 2, team: MERCEDES, number: 7, name: 'Anna R' }, { car: 3, team: MERCEDES, number: 7, name: null }] });
    const t = setup({ sessions: [s1] });
    for (const topic of ['drivers.profiles', 'drivers.links']) expect(t.count(topic), topic).toBeGreaterThan(0);
    const counts = () => [t.count('drivers.profiles'), t.count('drivers.links')] as const;
    const changes = (what: string, change: () => void) => {
      const [profiles, links] = counts();
      change();
      expect(counts()[0], what).toBeGreaterThan(profiles);
      expect(counts()[1], what).toBeGreaterThan(links);
    };

    changes('add', () => t.ok({ kind: 'drivers.add', person: 'anna', displayName: 'Anna' }));
    expect(t.persons().map((p) => p.person)).toEqual(['anna']);
    changes('link', () => t.ok({ kind: 'drivers.link', ...seat(s1, 2), person: 'anna' }));
    expect(t.persons()[0]?.links).toEqual([{ kind: 'nameAndNumber', name: 'Anna R', raceNumber: 7 }]);
    changes('override', () => t.ok({ kind: 'drivers.override', person: 'anna', key: 'fake.meanLapMs', value: 95_000 }));
    expect(valueOf(t.entry('anna', 'fake.meanLapMs'))).toBe(95_000);
    changes('clear', () => t.ok({ kind: 'drivers.override.clear', person: 'anna', key: 'fake.meanLapMs' }));
    expect(valueOf(t.entry('anna', 'fake.meanLapMs'))).toBe(mean([1, 2, 3, 4, 5].map((n) => 90_000 + n)));
    // Car 3 (no name, Anna's race number) is suggested; accepting links it.
    expect(t.last<DriversLinksValue>('drivers.links').unlinked.map((u) => [u.carId, u.suggestion?.person])).toEqual(expect.arrayContaining([[car(3), 'anna']]));
    // SP4.3b Task 2: drivers.accept removed.
    expect(t.last<DriversLinksValue>('drivers.links').unlinked.map((u) => u.carId)).not.toContain(car(3));
    changes('exclude', () => t.ok({ kind: 'drivers.exclude', person: 'anna', session: ref(s1) }));
    expect(t.persons()[0]?.excluded).toEqual([ref(s1)]);
    changes('session end', () => t.store.recompute('sessionEnd'));
  });

  it('a second open of the store fails on the lock with a reason; the lock is released on close', () => {
    const s1 = driverSession('1', { startedAt: day(1), slots: [HOST] });
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    const first = setup({ sessions: [s1], dir });
    expect(existsSync(join(dir, 'drivers', '.lock'))).toBe(true);

    // Another writer (the CLI while the bridge runs, P3) is refused, and told why.
    expect(() => setup({ sessions: [s1], dir })).toThrow(/drivers[\\/]\.lock/);
    first.ok({ kind: 'drivers.add', person: 'anna', displayName: 'Anna' });

    first.close();
    const second = setup({ sessions: [s1], dir });
    expect(second.persons().map((p) => p.person)).toEqual(['anna']);
  });
});
