// One session's basis (C38, C39, C54, C55, C61, C62; SP4.3e spec §4.2): the session-start basis, the context of a chosen
// basis, the basis sidecar and the `basis.active` topic, as the feed's pipeline hands them to its session.
//
// - Live (`live`): at the first Participants the C62 preselection (`preselect`) over the seat's earlier sessions of the
//   weekend and the team's last confirmed choice on the track; the session starts on the preselection's current
//   sessions, the sidecar `{ start, preselected }` is written, and the rest are made current (`ensureCurrent`, priority
//   `runningBasis`; no frame waits) and enter by a `basisChosen` naming the whole preselection, unless a basis was chosen
//   since (`commit`).
// - A replay or reprocess with the recording's sidecar (`recorded`), or a continued recording (C59): the session starts on
//   its `start`; its decisions come back from the decisions sidecar (C76).
// - A recording without a sidecar, or a run without the preselection's inputs: the seat's earlier sessions of the weekend.
import type { BasisActive } from '@pitwall/contracts';
import { basisKey, NO_BASIS, type BasisSidecar, type CarKey, type FeedId, type SessionBasis, type SessionRef, type TeamId, type TrackId, type WeekendPhase } from '@pitwall/domain';
import type { BasisContext, DeepReadonly } from '@pitwall/engine/readers';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { Logger } from '../log.ts';
import type { SessionKey, SessionRow, StoredSessionRow } from '../storage/db.ts';
import type { RebuildService } from '../storage/rebuild-service-types.ts';
import { basisSidecarPath } from './basis-sidecar.ts';
import type { LastChoice, LastChoiceStore } from './last-choice-types.ts';
import { preselect, type PreselectInput } from './session-basis.ts';
import type { SessionStorage } from './session-storage.ts';

/** The live preselection's inputs (C61, C62): the rebuild service and the team's last confirmed choices. */
export type BasisInputs = { rebuild: Pick<RebuildService, 'ensureCurrent'>; lastChoice: Pick<LastChoiceStore, 'read'> };

/** A rebuild's progress as `basis.active` shows it: sessions done of the total; `null` while nothing is rebuilt. */
export type BasisProgress = { done: number; total: number } | null;

export type BasisRunOptions = {
  feedId: FeedId;
  hub: Pick<TopicHub, 'publishState'>;
  log: Logger;
  storage: SessionStorage | undefined;
  /** Live, preselecting: the preselection's inputs; with `recorded`, a continued recording's queue only. */
  live?: BasisInputs;
  /** The recording's basis sidecar (a replay, a reprocess, a continued recording); `null`: the recording has none. */
  recorded?: BasisSidecar | null;
  /** The session file's recording, where a live session writes its basis sidecar; none without a session file. */
  file?: string;
  /** Writes a sidecar of the session file (a failure is the file's write failure). */
  writeSidecar: (path: string, value: unknown) => void;
  /** Commits `basisChosen { basis }` to the running session (the runner, with its next frame, and the decisions sidecar). */
  commit: (basis: SessionBasis) => void;
  /** Whether the running session holds a `basisChosen` decision, committed or pending. */
  chosen: () => boolean;
};

/**
 * The preselection's kind of the session from its weekend phase (C14). At the first Participants no frame has been
 * applied, so the phase is still pending there and a race's rule applies (both kinds).
 */
const kindOf = (phase: WeekendPhase): PreselectInput['kind'] =>
  phase.kind === 'practice' || phase.kind === 'qualifying' ? phase.kind : phase.kind === 'race' && phase.format === 'sprint' ? 'sprint' : 'race';

const refsOf = (basis: SessionBasis): SessionRef[] => [...basis.practice, ...(basis.qualifying === null ? [] : [basis.qualifying])];
const refText = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;
const keyOfRow = (row: StoredSessionRow): SessionKey => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar });

/** The part of `basis` whose sessions are in `rows` (the current ones), in `basis`'s order. */
const within = (basis: SessionBasis, rows: readonly StoredSessionRow[]): SessionBasis => {
  const has = (ref: SessionRef): boolean => rows.some((row) => row.sessionUid === ref.sessionUid && row.weekendId === ref.weekendId);
  return { practice: basis.practice.filter(has), qualifying: basis.qualifying !== null && has(basis.qualifying) ? basis.qualifying : null };
};

const lastChoiceOf = (choice: LastChoice | undefined): BasisActive['lastChoice'] =>
  choice === undefined ? null : { basis: { practice: [...choice.basis.practice.refs], qualifying: choice.basis.qualifying.ref }, plan: choice.plan.id };

/** One session's basis; built when the session starts, closed when it ends. */
export class BasisRun {
  readonly #o: BasisRunOptions;
  /** The player's seat (team and race number), once the first Participants named it. */
  #player: CarKey | undefined;
  #start: SessionBasis | undefined;
  #lastChoice: BasisActive['lastChoice'] = null;
  /** The basis in use at the newest applied frame. */
  #inUse: SessionBasis | undefined;
  #raceLaps: number | null = null;
  #rebuilding: BasisProgress = null;
  /** The named sessions' rows by `refText`, read once each. */
  readonly #rows = new Map<string, StoredSessionRow | null>();
  /** The last `basis.active` published, as JSON: published again only when it changes. */
  #published: string | undefined;
  #closed = false;

  constructor(opts: BasisRunOptions) {
    this.#o = opts;
  }

  /** The player's seat, once the session started. */
  get player(): CarKey | undefined {
    return this.#player;
  }

  /**
   * The session-start basis of `row`'s session for the player's seat (`basis.start`, asked once at the first
   * Participants); `undefined` when storage is off.
   */
  start(player: CarKey, row: SessionRow, phase: WeekendPhase): BasisContext | undefined {
    this.#player = player;
    const { recorded, live } = this.#o;
    if (recorded !== undefined && recorded !== null) {
      this.#start = recorded.start;
      if (live !== undefined) this.#queue(recorded.preselected, recorded.start, live);
    } else if (live !== undefined && recorded === undefined) {
      this.#startLive(player, row, phase, live);
    } else {
      const context = this.#o.storage?.weekendContext(row, player);
      this.#start = context?.basis ?? NO_BASIS;
      this.#inUse = this.#start;
      this.#publish();
      return context;
    }
    this.#inUse = this.#start;
    this.#publish();
    return this.#o.storage?.basisContext(this.#start ?? NO_BASIS, player);
  }

  /** The context of a chosen basis for the player's seat (`basis.registered`, C62): only the sessions the seat stored. */
  registered(basis: SessionBasis): BasisContext | undefined {
    const player = this.#player;
    return player === undefined ? undefined : this.#o.storage?.basisContext(basis, player);
  }

  /**
   * The keys of `basis`'s sessions the seat stored, current or stale: what to make current before it enters (C61). The
   * seat is the session's player's, or `player` before the first Participants reached the runner.
   */
  keysOf(basis: SessionBasis, player: CarKey | undefined = this.#player): SessionKey[] {
    if (player === undefined) return [];
    return (this.#o.storage?.seatRowsOf(refsOf(basis), player) ?? []).map(keyOfRow);
  }

  /**
   * The team's basis for a feed that joins it (C1a, C62): committed at once when the seat's sessions of it are current,
   * else once they are (`ensureCurrent`, priority `runningBasis`; no frame waits), and then only while `still()` holds
   * (no newer choice of the team meanwhile).
   */
  enter(basis: SessionBasis, player: CarKey, still: () => boolean): void {
    const { storage, live, log, feedId } = this.#o;
    const stale = (storage?.seatRowsOf(refsOf(basis), player) ?? []).filter((row) => storage?.isStale(row)).map(keyOfRow);
    if (stale.length === 0 || live === undefined) {
      this.#o.commit(basis);
      return;
    }
    live.rebuild
      .ensureCurrent(stale, { priority: 'runningBasis', onProgress: (n, total) => this.rebuilding({ done: n, total }) })
      .then(
        () => {
          this.rebuilding(null);
          if (!this.#closed && still()) this.#o.commit(basis);
        },
        (error: unknown) => {
          log.error({ feedId, err: error }, "the team's basis not made current: the joining feed stays on its own");
          this.rebuilding(null);
        },
      );
  }

  /** After each applied frame: the basis in use there and the race laps (`null` outside a race), for `basis.active`. */
  applied(o: { basis: DeepReadonly<SessionBasis> | undefined; phase: DeepReadonly<WeekendPhase>; totalLaps: number }): void {
    if (this.#start === undefined) return;
    // The state's basis is read-only and only read here (published as it is, C54).
    this.#inUse = (o.basis as SessionBasis | undefined) ?? this.#start;
    this.#raceLaps = o.phase.kind === 'race' ? o.totalLaps : null;
    this.#publish();
  }

  /** A rebuild of the sessions a basis names: its progress, or `null` once it is done. */
  rebuilding(progress: BasisProgress): void {
    if (this.#closed) return;
    this.#rebuilding = progress;
    this.#publish();
  }

  /** The session ended: nothing more is committed or published. */
  close(): void {
    this.#closed = true;
  }

  #startLive(player: CarKey, row: SessionRow, phase: WeekendPhase, live: BasisInputs): void {
    const { storage, log, feedId } = this.#o;
    let last: LastChoice | undefined;
    try {
      last = live.lastChoice.read(player.teamId as TeamId, row.trackId as TrackId);
    } catch (error) {
      log.error({ feedId, err: error }, 'last choice not read: the preselection has none');
    }
    this.#lastChoice = lastChoiceOf(last);
    const own = storage?.seatSessionsBefore(row, player) ?? [];
    const { basis: preselected } = preselect({ own, last, kind: kindOf(phase) });
    // The session starts on the preselection's current sessions (C61, C62).
    const current = (storage?.seatRowsOf(refsOf(preselected), player) ?? []).filter((r) => !storage?.isStale(r));
    this.#start = within(preselected, current);
    const { file } = this.#o;
    if (file !== undefined) this.#o.writeSidecar(basisSidecarPath(file), { start: this.#start, preselected } satisfies BasisSidecar);
    this.#queue(preselected, this.#start, live);
  }

  /**
   * The preselection's sessions the session did not start on: those the seat stored are made current, and then the whole
   * preselection enters by decision, unless a basis was chosen since (C62). No frame waits for it.
   */
  #queue(preselected: SessionBasis, start: SessionBasis, live: BasisInputs): void {
    const player = this.#player;
    if (player === undefined || basisKey(preselected) === basisKey(start)) return;
    const startRefs = new Set(refsOf(start).map(refText));
    const missing = (this.#o.storage?.seatRowsOf(refsOf(preselected), player) ?? []).filter((row) => !startRefs.has(refText(row)));
    if (missing.length === 0) return;
    const { log, feedId } = this.#o;
    const keys = missing.map(keyOfRow);
    const done = (): void => {
      this.rebuilding(null);
      if (this.#closed || this.#o.chosen()) return;
      this.#o.commit(preselected);
    };
    live.rebuild
      .ensureCurrent(keys, { priority: 'runningBasis', onProgress: (n, total) => this.rebuilding({ done: n, total }) })
      .then(done, (error: unknown) => {
        log.error({ feedId, err: error }, 'preselected basis not made current: the session stays on its start');
        this.rebuilding(null);
      });
  }

  /** `basis.active` (C54, C55): published by the feed's pipeline, typed by its topic file, whenever it changes. */
  #publish(): void {
    if (this.#closed || this.#start === undefined) return;
    const basis = this.#inUse ?? this.#start;
    const value: BasisActive = {
      basis,
      start: this.#start,
      sessions: this.#sessionsOf([basis, this.#start, ...(this.#lastChoice === null ? [] : [this.#lastChoice.basis])]),
      plan: null,
      raceLaps: this.#raceLaps,
      rebuilding: this.#rebuilding,
      lastChoice: this.#lastChoice,
    };
    const json = JSON.stringify(value);
    if (json === this.#published) return;
    this.#published = json;
    this.#o.hub.publishState(this.#o.feedId, 'basis.active', () => value);
  }

  /** Per session the bases name and the seat stored, its date, kind (its place in the basis) and track. */
  #sessionsOf(bases: readonly SessionBasis[]): BasisActive['sessions'] {
    const sessions: BasisActive['sessions'] = {};
    for (const basis of bases) {
      const roles: Array<[SessionRef, 'practice' | 'qualifying']> = [
        ...basis.practice.map((ref): [SessionRef, 'practice'] => [ref, 'practice']),
        ...(basis.qualifying === null ? [] : [[basis.qualifying, 'qualifying'] as [SessionRef, 'qualifying']]),
      ];
      for (const [ref, kind] of roles) {
        const row = this.#rowOf(ref);
        if (row !== null && sessions[refText(ref)] === undefined) sessions[refText(ref)] = { date: row.startedAt, kind, trackId: row.trackId as TrackId };
      }
    }
    return sessions;
  }

  #rowOf(ref: SessionRef): StoredSessionRow | null {
    const text = refText(ref);
    const cached = this.#rows.get(text);
    if (cached !== undefined) return cached;
    const player = this.#player;
    const row = player === undefined ? null : (this.#o.storage?.seatRowsOf([ref], player)?.[0] ?? null);
    this.#rows.set(text, row);
    return row;
  }
}
