// The calibration store (C62a, spec 3.1 to 3.3): the bridge's owner of the calibration sets (files under
// `<data dir>/calibration/`, the source of truth) and of the priors store (`<data dir>/priors.sqlite`, a cache). It
// applies the calibration uiActions, rejecting an invalid one with a reason (C73); runs the units' declared priors
// functions over the sets' sources, read from the stored projections (C34); and publishes `calibration.sets`, `.values`
// and `.candidates` itself, as the UI state publishes `ui.*` (C54, C55). It decides nothing about the data (C43): the
// units' functions do; it resolves, orders and stores. A stale stored session it reads (C61) is skipped, and its rebuild
// requested once; once that settles, the store recomputes.
import { join } from 'node:path';
import type { TopicName } from '@pitwall/contracts';
import { known, trackDataOf, type CalibrationSet, type CalibrationValuesValue, type PriorsSnapshot, type SourceFit } from '@pitwall/domain';
import type { FallbackCtx } from '@pitwall/engine/readers';
import type { FeatureConfig } from '../feature-config.ts';
import { loadTrackFile, TRACKS_DIR } from '../track-files/load.ts';
import type { Feature } from '../features/feature.ts';
import type { ValueFor } from '../hub/topic-hub.ts';
import type { Logger } from '../log.ts';
import type { SessionKey } from '../storage/db.ts';
import type { SessionsOnTrack, TrackSession } from '../storage/weekend-repository.ts';
import { PriorsCache, snapshotFingerprint, PriorsRunner, resolveSource } from './compute.ts';
import { loadSets, removeSet, stintKey, writeSet } from './sets.ts';
import { suggestions } from './suggest.ts';
import { checkAction, type CalibrationAction } from './validate.ts';

export { isCalibrationAction, type CalibrationAction } from './validate.ts';

export type ApplyResult = { ok: true } | { ok: false; reason: 'invalid'; message: string };

export type CalibrationStoreDeps = {
  /** The features whose `priors` declarations the store runs (C63). */
  features: readonly Feature[];
  repo: SessionsOnTrack;
  /** The effective config (C47): the priors functions read the units' thresholds from it. */
  config: FeatureConfig;
  hub: { publishGlobal(topic: TopicName, valueFor: ValueFor): void };
  log: Logger;
  /**
   * Rebuilds stored sessions from their recordings (C61). The store asks once per session it read stale and recomputes
   * once the rebuild settles; a rejection is logged and the sources stay `stale`.
   */
  rebuild: (keys: readonly SessionKey[]) => Promise<void>;
  /** Now as an ISO date, for a new set's `createdAt`. Default: the wall clock. */
  now?: () => string;
};

type SetValues = CalibrationValuesValue['bySet'][string];
type TrackOf = FallbackCtx['track'];

const OK: ApplyResult = { ok: true };
const byStart = (a: TrackSession, b: TrackSession): number => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0);
const keyText = (s: SessionKey): string => `${s.sessionUid}/${s.weekendId}/${s.playerCar}`;
const setKeyOf =(set: Pick<CalibrationSet, 'trackId' | 'id'>): string => `${set.trackId}/set/${set.id}`;

export class CalibrationStore {
  readonly #root: string;
  readonly #deps: CalibrationStoreDeps;
  readonly #cache: PriorsCache;
  readonly #runner: PriorsRunner;
  /** Every set by id (ids are unique across tracks, so `calibration.values` keys them alone). */
  readonly #sets = new Map<string, CalibrationSet>();
  readonly #values = new Map<string, SetValues>();
  readonly #candidates = new Map<number, SourceFit[]>();
  /** Each track's committed track file as the defaults read it (C62b), loaded once: the files are fixed for the bridge's run. */
  readonly #tracks = new Map<number, TrackOf>();
  /** The stale sessions whose rebuild was requested (`keyText`): never requested again in this run. */
  readonly #rebuildRequested = new Set<string>();
  #closed = false;

  private constructor(root: string, deps: CalibrationStoreDeps) {
    this.#root = root;
    this.#deps = deps;
    this.#cache = new PriorsCache(join(root, 'priors.sqlite'));
    this.#runner = new PriorsRunner(deps.features.flatMap((f) => f.priors ?? []), this.#cache, deps.config, deps.log);
  }

  /** Loads the sets under `dataDir`, computes their entries (from the cache where it is current) and publishes the topics. */
  static open(dataDir: string, deps: CalibrationStoreDeps): CalibrationStore {
    const store = new CalibrationStore(dataDir, deps);
    for (const set of loadSets(dataDir, deps.log)) store.#sets.set(set.id, set);
    store.#recomputeAll();
    store.#publishAll();
    return store;
  }

  /** Applies one calibration uiAction; an invalid one is rejected with a reason and changes nothing (C73). */
  apply(action: CalibrationAction): ApplyResult {
    const checked = checkAction(action, {
      sets: [...this.#sets.values()],
      sessionsOnTrack: (trackId) => this.#deps.repo.sessionsOnTrack(trackId),
      entry: (key) => this.#runner.entryDecl(key),
      now: this.#deps.now ?? (() => new Date().toISOString()),
    });
    if (!checked.ok) return { ok: false, reason: 'invalid', message: checked.message };
    const { edit } = checked;
    if ('prefer' in edit) {
      // `preferred` is outside every set's fingerprint: nothing to recompute (C62a).
      for (const set of edit.prefer.writes) {
        writeSet(this.#root, set);
        this.#sets.set(set.id, set);
      }
      this.#publishSets();
      return OK;
    }
    if ('write' in edit) {
      writeSet(this.#root, edit.write);
      this.#sets.set(edit.write.id, edit.write);
    } else {
      removeSet(this.#root, edit.remove);
      this.#sets.delete(edit.remove.id);
      this.#values.delete(edit.remove.id);
    }
    this.#recomputeTrack('write' in edit ? edit.write.trackId : edit.remove.trackId);
    this.#publishAll();
    return OK;
  }

  /**
   * The run's set at session start (spec 3.3; SP4.3b spec 10): the track's preferred set, else the newest `lastUsedAt`,
   * else the newest source session, else none.
   */
  preselect(trackId: number): PriorsSnapshot | null {
    const sets = this.#setsOf(trackId);
    const used = sets.filter((s) => s.lastUsedAt !== undefined).toSorted((a, b) => ((a.lastUsedAt ?? '') < (b.lastUsedAt ?? '') ? 1 : -1));
    const chosen = sets.find((s) => s.preferred) ?? used[0] ?? this.#newestBySources(trackId, sets);
    return chosen === undefined ? null : (this.snapshotOf(trackId, chosen.id) ?? null);
  }

  /**
   * The set's entries as a run gets them, named by their fingerprint (C62a); `undefined` for a set the track does not
   * hold (a pick of a deleted set, or of one on another track: an expected problem, C3).
   */
  snapshotOf(trackId: number, setId: string): PriorsSnapshot | undefined {
    const set = this.#sets.get(setId);
    const values = this.#values.get(setId);
    if (set === undefined || set.trackId !== trackId || values === undefined) return undefined;
    const snapshot = { setId, setName: set.name, sources: values.fits.filter((f) => f.skipped === undefined).length, entries: values.entries };
    return { fingerprint: snapshotFingerprint(snapshot), ...snapshot };
  }

  /** The track a set belongs to; `undefined` for an unknown set (C3). */
  trackOf(setId: string): number | undefined {
    return this.#sets.get(setId)?.trackId;
  }

  /** Records that a run started on the set or picked it (spec 3.3). */
  markUsed(trackId: number, setId: string, at: string): void {
    const set = this.#sets.get(setId);
    if (set === undefined || set.trackId !== trackId) {
      this.#deps.log.warn({ trackId, setId }, 'markUsed: no such calibration set');
      return;
    }
    const used = { ...set, lastUsedAt: at };
    writeSet(this.#root, used);
    this.#sets.set(setId, used);
    this.#publishSets();
  }

  /** Recomputes every set and the suggestions: at session end (new candidates) and after a rebuild (C61). */
  recompute(trigger: 'edit' | 'sessionEnd' | 'rebuild'): void {
    this.#deps.log.debug({ trigger }, 'calibration recompute');
    this.#recomputeAll();
    this.#publishAll();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cache.close();
  }

  #setsOf(trackId: number): CalibrationSet[] {
    return [...this.#sets.values()].filter((s) => s.trackId === trackId);
  }

  /** The set whose newest source session started last; none when no set has a stored source session. */
  #newestBySources(trackId: number, sets: readonly CalibrationSet[]): CalibrationSet | undefined {
    const sessions = this.#deps.repo.sessionsOnTrack(trackId);
    let best: { set: CalibrationSet; startedAt: string } | undefined;
    for (const set of sets) {
      for (const source of set.sources) {
        const session = sessions.find((s) => s.sessionUid === source.sessionUid && s.weekendId === source.weekendId && s.playerCar === source.feedCar);
        if (session !== undefined && (best === undefined || session.startedAt > best.startedAt)) best = { set, startedAt: session.startedAt };
      }
    }
    return best?.set;
  }

  #recomputeAll(): void {
    this.#runner.startPass();
    const tracks = new Set([...this.#sets.values()].map((s) => s.trackId));
    for (const trackId of this.#candidates.keys()) if (!tracks.has(trackId)) this.#candidates.delete(trackId);
    for (const trackId of tracks) this.#recomputeTrack(trackId);
    // A full pass touched every key still in use: the rest is of sets, sources or candidates that are gone.
    this.#cache.prune(this.#runner.touched);
  }

  /** The entries and fits of every set of the track, and the track's suggestions. */
  #recomputeTrack(trackId: number): void {
    const sessions = this.#deps.repo.sessionsOnTrack(trackId).toSorted(byStart);
    const sets = this.#setsOf(trackId);
    for (const set of sets) {
      const resolved = set.sources.map((source) => resolveSource(source, sessions));
      const stored = resolved.flatMap((r) => ('stored' in r ? [r.stored] : []));
      const computed = this.#runner.aggregates(setKeyOf(set), stored, set.overrides);
      const entries = this.#runner.setEntries(computed, set.overrides);
      const fits = resolved.map((r) => this.#runner.fit(r, `${setKeyOf(set)}/${stintKey(r.source)}`, set.overrides, entries));
      const defaults = this.#runner.defaults(entries, this.#trackFile(trackId));
      const samples = this.#runner.samples(setKeyOf(set), stored, set.overrides);
      const missing = resolved.filter((r) => 'skipped' in r && r.skipped === 'missing').length;
      this.#values.set(set.id, { entries, fits, defaults, samples, missing });
    }
    if (sets.length === 0) this.#candidates.delete(trackId);
    else {
      this.#candidates.set(trackId, suggestions(trackId, sessions, sets, this.#runner));
      // The sets' sources and the suggestions read every stored session on the track: a stale one awaits its rebuild.
      this.#requestRebuild(sessions.filter((s) => s.stale));
    }
  }

  /** The track's committed file as `view.track` holds it; a missing or invalid one is `notApplicable` (C62b, C3). */
  #trackFile(trackId: number): TrackOf {
    let track = this.#tracks.get(trackId);
    if (track === undefined) {
      const file = loadTrackFile(trackId, TRACKS_DIR, this.#deps.log);
      track = file.known ? known(trackDataOf(file.value), file.at) : file;
      this.#tracks.set(trackId, track);
    }
    return track;
  }

  /** Asks for the rebuild of the stale sessions not asked for yet (C61), then recomputes; a failure is logged, never thrown. */
  #requestRebuild(stale: readonly TrackSession[]): void {
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
          log.error({ err: error, sessions: keys.map(keyText) }, 'stored sessions not rebuilt: their calibration sources stay stale');
        },
      )
      .catch((error: unknown) => {
        log.error({ err: error }, 'calibration recompute after a rebuild failed');
      });
  }

  #publishSets(): void {
    const sets = [...this.#sets.values()].toSorted((a, b) => a.trackId - b.trackId || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    this.#deps.hub.publishGlobal('calibration.sets', () => ({ sets }));
  }

  #publishAll(): void {
    this.#publishSets();
    const bySet = Object.fromEntries(this.#values);
    this.#deps.hub.publishGlobal('calibration.values', () => ({ bySet }));
    const byTrack = Object.fromEntries(this.#candidates);
    // The panel's track without a running session: the newest stored session's (spec 6).
    const newestTrackId = this.#deps.repo.newestTrackId();
    this.#deps.hub.publishGlobal('calibration.candidates', () => ({ byTrack, newestTrackId }));
  }
}
