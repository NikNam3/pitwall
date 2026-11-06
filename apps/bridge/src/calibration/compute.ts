// Runs the units' declared priors functions over calibration sources (C62a, spec 3.2) and caches what the aggregates
// give in `priors.sqlite`. The units judge (C43): the store only resolves the sources from the stored projections
// (C34), calls the declared functions and stores their results. The cache holds per (set key, priors key) one value
// with its aggregate's version and the fingerprint of its inputs (sources, overrides, config); a mismatch recomputes
// it, and deleting the file loses nothing.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@pitwall/contracts';
import {
  currentLaps, known, unknown,
  type CalibrationSource, type CalibrationValuesValue, type CarId, type Known, type LapUse, type PriorsEntries, type PriorsSnapshot,
  type SourceFit,
} from '@pitwall/domain';
import type { FallbackCtx, PriorsCtx, PriorsDecl, StoredSource } from '@pitwall/engine/readers';
import type { Logger } from '../log.ts';
import type { TrackSession } from '../storage/weekend-repository.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The cache of computed priors entries (`priors.sqlite`). */
export class PriorsCache {
  readonly #db: Database.Database;
  readonly #get;
  readonly #put;

  constructor(path: string) {
    this.#db = new Database(path);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS entries (
      set_key TEXT NOT NULL, prior_key TEXT NOT NULL, version INTEGER NOT NULL, fingerprint TEXT NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY (set_key, prior_key))`);
    this.#get = this.#db.prepare('SELECT version, fingerprint, value_json FROM entries WHERE set_key = ? AND prior_key = ?');
    this.#put = this.#db.prepare('INSERT OR REPLACE INTO entries (set_key, prior_key, version, fingerprint, value_json) VALUES (?, ?, ?, ?, ?)');
  }

  /** The cached value, if it was computed by `version` from inputs with `fingerprint`. */
  get(setKey: string, priorKey: string, version: number, fingerprint: string): Known<number> | undefined {
    const row = this.#get.get(setKey, priorKey) as { version: number; fingerprint: string; value_json: string } | undefined;
    return row !== undefined && row.version === version && row.fingerprint === fingerprint ? (JSON.parse(row.value_json) as Known<number>) : undefined;
  }

  put(setKey: string, priorKey: string, version: number, fingerprint: string, value: Known<number>): void {
    this.#put.run(setKey, priorKey, version, fingerprint, JSON.stringify(value));
  }

  /** Drops every row whose set key is not in `kept` (sets, sources and candidates that are gone). */
  prune(kept: ReadonlySet<string>): void {
    const keys = this.#db.prepare('SELECT DISTINCT set_key FROM entries').pluck().all() as string[];
    const drop = this.#db.prepare('DELETE FROM entries WHERE set_key = ?');
    this.#db.transaction(() => { for (const key of keys) if (!kept.has(key)) drop.run(key); })();
  }

  close(): void {
    if (this.#db.open) this.#db.close();
  }
}

/** A source resolved against the stored sessions: its stored source, or why it is left out (spec 3.1). */
export type Resolved =
  | { source: CalibrationSource; session: TrackSession; stored: StoredSource }
  | { source: CalibrationSource; session: TrackSession | undefined; skipped: 'missing' | 'stale' };

/** The driver name of the session's slot `car` as its stored row holds it; unknown for a slot the row does not hold. */
const driverOf = (session: Pick<TrackSession, 'cars'>, car: CarId): Known<string> =>
  session.cars.find((c) => c.carId === car)?.driver ?? unknown('notReceived');

const sessionOf = (source: CalibrationSource, sessions: readonly TrackSession[]): TrackSession | undefined =>
  sessions.find((s) => s.sessionUid === source.sessionUid && s.weekendId === source.weekendId && s.playerCar === source.feedCar);

/**
 * The source's stint in its session's projection (C34): its laps (current versions, C25) minus the excluded ones, every
 * stop and every car's current laps of the session, its weekend phase and track file. `missing` when the session or the
 * stint is gone, `stale` when the session awaits a rebuild (C61).
 */
export function resolveSource(source: CalibrationSource, sessions: readonly TrackSession[]): Resolved {
  const session = sessionOf(source, sessions);
  if (session === undefined) return { source, session, skipped: 'missing' };
  if (session.stale || session.projection === undefined) return { source, session, skipped: 'stale' };
  const { projection } = session;
  const stint = projection.stints.find((s) => s.carId === source.car && s.firstLap === source.firstLap);
  if (stint === undefined) return { source, session, skipped: 'missing' };
  const sessionLaps = currentLaps(projection.laps);
  const excluded = new Set(source.excludedLaps);
  const laps = sessionLaps.filter((l) => l.carId === stint.carId && l.lapNumber >= stint.firstLap && l.lapNumber <= stint.lastLap && !excluded.has(l.lapNumber));
  return { source, session, stored: { source, phase: session.phase, stint, laps, pitStops: projection.pitStops, sessionLaps, track: session.track } };
}

/** Runs the declared functions; a unit's function that throws is a bug of that unit: logged, its value unknown (C48). */
export class PriorsRunner {
  readonly #decls: readonly PriorsDecl[];
  readonly #cache: PriorsCache;
  readonly #config: PriorsCtx['config'];
  readonly #log: Logger;
  /** The set keys this runner read or wrote since `startPass`. */
  #touched = new Set<string>();

  constructor(decls: readonly PriorsDecl[], cache: PriorsCache, config: PriorsCtx['config'], log: Logger) {
    this.#decls = decls;
    this.#cache = cache;
    this.#config = config;
    this.#log = log;
  }

  /** Every declared key with its declaration. */
  entryDecl(key: string): PriorsDecl['entries'][string] | undefined {
    for (const decl of this.#decls) if (Object.hasOwn(decl.entries, key)) return decl.entries[key];
    return undefined;
  }

  ctx(overrides: Readonly<Record<string, number>>): PriorsCtx {
    return { config: this.#config, overrides };
  }

  startPass(): void {
    this.#touched = new Set();
  }

  /** The set keys read or written since `startPass`: what a full pass keeps in the cache. */
  get touched(): ReadonlySet<string> {
    return this.#touched;
  }

  /** Every declared aggregate over `sources`, from the cache when its version and inputs are unchanged. */
  aggregates(setKey: string, sources: readonly StoredSource[], overrides: Readonly<Record<string, number>>): PriorsEntries {
    this.#touched.add(setKey);
    const ctx = this.ctx(overrides);
    const fingerprint = sha256(canonicalJson({ sources, overrides, config: this.#config }));
    const entries: PriorsEntries = {};
    for (const decl of this.#decls) {
      for (const [key, entry] of Object.entries(decl.entries)) {
        if (entry.aggregate === undefined) continue;
        const cached = this.#cache.get(setKey, key, entry.version, fingerprint);
        if (cached !== undefined) {
          entries[key] = cached;
          continue;
        }
        const value = this.#call(decl, key, () => entry.aggregate?.(sources, ctx) ?? unknown('notApplicable'));
        if (value === undefined) entries[key] = unknown('notApplicable');
        else {
          entries[key] = value;
          this.#cache.put(setKey, key, entry.version, fingerprint, value);
        }
      }
    }
    return entries;
  }

  /**
   * Per key that declares `samples`: the unit's count of the samples its aggregate rests on over `sources` (the panel's
   * N and STOPS), cached as the aggregates are (under `<key>#samples`). A count that throws is logged and not listed.
   */
  samples(setKey: string, sources: readonly StoredSource[], overrides: Readonly<Record<string, number>>): Record<string, number> {
    this.#touched.add(setKey);
    const ctx = this.ctx(overrides);
    const fingerprint = sha256(canonicalJson({ sources, overrides, config: this.#config }));
    const samples: Record<string, number> = {};
    for (const decl of this.#decls) {
      for (const [key, entry] of Object.entries(decl.entries)) {
        if (entry.samples === undefined) continue;
        const cacheKey = `${key}#samples`;
        const cached = this.#cache.get(setKey, cacheKey, entry.version, fingerprint);
        if (cached?.known === true) {
          samples[key] = cached.value;
          continue;
        }
        const count = this.#call(decl, cacheKey, () => entry.samples?.(sources, ctx));
        if (count === undefined) continue;
        samples[key] = count;
        this.#cache.put(setKey, cacheKey, entry.version, fingerprint, known(count, 0));
      }
    }
    return samples;
  }

  /** A set's entries: the computed ones, an override in place of its key's value; an override-only key is unknown until set. */
  setEntries(computed: PriorsEntries, overrides: Readonly<Record<string, number>>): PriorsEntries {
    const entries: PriorsEntries = {};
    for (const decl of this.#decls) {
      for (const key of Object.keys(decl.entries)) {
        const override = overrides[key];
        entries[key] = override !== undefined ? known(override, 0) : (computed[key] ?? unknown('notApplicable'));
      }
    }
    return entries;
  }

  /**
   * Per key whose entry in `set` is unknown (no source or override covers it) and that declares a `fallback`: that
   * fallback over `track` (the set's track's file, C62b) and the effective config (C47), the value a run on the set uses
   * for the key with its default source (spec 6, R35). A fallback that throws is logged and not listed.
   */
  defaults(set: PriorsEntries, track: FallbackCtx['track']): CalibrationValuesValue['bySet'][string]['defaults'] {
    const ctx: FallbackCtx = { config: this.#config, track };
    const defaults: CalibrationValuesValue['bySet'][string]['defaults'] = {};
    for (const decl of this.#decls) {
      for (const [key, entry] of Object.entries(decl.entries)) {
        if (entry.fallback === undefined || set[key]?.known === true) continue;
        const value = this.#call(decl, key, () => entry.fallback?.(ctx));
        if (value !== undefined) defaults[key] = value;
      }
    }
    return defaults;
  }

  /** Each declared `residual`: a source's own entries against the set's (spec 3.2, A23). */
  residuals(source: PriorsEntries, set: PriorsEntries): Record<string, Known<number>> {
    const residuals: Record<string, Known<number>> = {};
    for (const decl of this.#decls) {
      for (const [key, entry] of Object.entries(decl.entries)) {
        if (entry.residual === undefined) continue;
        residuals[key] = this.#call(decl, key, () => entry.residual?.(source, set) ?? unknown('notApplicable')) ?? unknown('notApplicable');
      }
    }
    return residuals;
  }

  /** Whether some unit's `candidate` accepts the stint as a source. */
  accepts(stored: StoredSource): boolean {
    const ctx = this.ctx({});
    return this.#decls.some((decl) => decl.candidate !== undefined && this.#call(decl, 'candidate', () => decl.candidate?.(stored, ctx) ?? false) === true);
  }

  /** Per lap number, how the first unit that declares `lapUse` uses the lap. */
  lapUses(stored: StoredSource, overrides: Readonly<Record<string, number>>): Record<number, LapUse> | undefined {
    const ctx = this.ctx(overrides);
    let uses: Record<number, LapUse> | undefined;
    for (const decl of this.#decls) {
      if (decl.lapUse === undefined) continue;
      const own = this.#call(decl, 'lapUse', () => decl.lapUse?.(stored, ctx) ?? {});
      if (own !== undefined) uses = { ...own, ...uses };
    }
    return uses;
  }

  /**
   * The panel's view of one source (spec 3.2, A23): its own entries (each aggregate over this source alone), their
   * residuals against `set`, its lap list with the units' lap use, its session's weekend phase and its car's driver name
   * (shown only); a skipped source has none of the computed ones (C3): only its session's date, its weekend phase (known
   * while its session is stored and not stale: a stale log is not read, C61), its car's driver name (from its session's
   * row) and its compound (unknown: its stint is not read), each unknown when the session is gone.
   */
  fit(resolved: Resolved, setKey: string, overrides: Readonly<Record<string, number>>, set: PriorsEntries | undefined): SourceFit {
    const { source, session } = resolved;
    if (!('stored' in resolved)) {
      return {
        source, skipped: resolved.skipped,
        sessionDate: session === undefined ? unknown('notReceived') : known(session.startedAt, 0),
        phase: session === undefined ? unknown('notReceived') : session.stale ? unknown('notApplicable') : known(session.phase, 0),
        driver: session === undefined ? unknown('notReceived') : driverOf(session, source.car),
        compound: session === undefined ? unknown('notReceived') : unknown('notApplicable'),
      };
    }
    const sessionDate = resolved.session.startedAt;
    const { stored } = resolved;
    const { phase } = stored;
    const driver = driverOf(resolved.session, source.car);
    const entries = this.aggregates(setKey, [stored], overrides);
    const uses = this.lapUses(stored, overrides);
    const excluded = new Set(source.excludedLaps);
    const lapList = stored.sessionLaps
      .filter((l) => l.carId === stored.stint.carId && l.lapNumber >= stored.stint.firstLap && l.lapNumber <= stored.stint.lastLap)
      .map((l) => {
        const use = uses?.[l.lapNumber];
        return {
          lapNumber: l.lapNumber, lapTimeMs: known(l.lapTimeMs, l.completedAt), excluded: excluded.has(l.lapNumber),
          use: use === undefined ? unknown('notApplicable') : known(use, l.completedAt),
        };
      });
    const usedLaps = uses === undefined
      ? stored.laps.length
      : stored.laps.filter((l) => uses[l.lapNumber] === 'used' || uses[l.lapNumber] === 'downWeighted').length;
    return {
      source, sessionDate, phase, driver, compound: stored.stint.visualCompound, laps: stored.laps.length, usedLaps, lapList, entries,
      residuals: set === undefined ? {} : this.residuals(entries, set),
    };
  }

  #call<T>(decl: PriorsDecl, what: string, run: () => T): T | undefined {
    try {
      return run();
    } catch (error) {
      this.#log.error({ err: error, unit: decl.unit, what }, 'a priors function failed: its value is unknown');
      return undefined;
    }
  }
}

/**
 * A snapshot's fingerprint, its name (C62a): a hash of the whole snapshot (set id, set name, sources count and entries),
 * keys in a fixed order, so two sets with equal entries are two snapshots and a reload of a set gives the same one.
 */
export const snapshotFingerprint = (snapshot: Omit<PriorsSnapshot, 'fingerprint'>): string =>
  sha256(canonicalJson({ setId: snapshot.setId, setName: snapshot.setName, sources: snapshot.sources, entries: snapshot.entries }));
