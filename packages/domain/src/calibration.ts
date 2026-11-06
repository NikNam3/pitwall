// Calibration sets, priors snapshots and the calibration topics' values (contract C62a, spec 3). JSON-safe.
import type { EstimateSource } from './estimates.ts';
import type { WeekendPhase } from './weekend-phase.ts';
import type { VisualCompound } from './compounds.ts';
import type { CarId, SessionUid } from './ids.ts';
import type { Known } from './known.ts';
import type { Ms } from './units.ts';

/**
 * One source of a calibration set: a stint of a stored session, minus the laps the user excludes (spec 3.1). Named by
 * its stored session's key (C60), its car and its first lap, which stay stable across a rebuild, unlike a list position.
 */
export type CalibrationSource = {
  /** The stored session's key (C60): session uid, weekend id and the feed's player car. */
  sessionUid: SessionUid;
  weekendId: string;
  feedCar: CarId;
  /** The stint's car in that session: the feed's player car or its teammate. */
  car: CarId;
  /** The stint's first lap (`StintRecord.firstLap`). */
  firstLap: number;
  /** Lap numbers of the stint the user left out. */
  excludedLaps: number[];
};

/**
 * A calibration set (C62a): named calibration data for one track, authored by the user and owned by the bridge
 * (`PITWALL_DATA_DIR/calibration/<trackId>/<id>.json`, the source of truth, not a cache).
 */
export type CalibrationSet = {
  /** Kebab-case, unique per track. */
  id: string;
  trackId: number;
  /** The user's label. */
  name: string;
  /** ISO date, shown only; never in a view (C35). */
  createdAt: string;
  sources: CalibrationSource[];
  /** Priors key to value, e.g. `"degradation.nuMsPerLap.medium"`; replaces the computed entry. */
  overrides: Record<string, number>;
  /** ISO date; set by the bridge when a run starts on the set or picks it. */
  lastUsedAt?: string;
};

/**
 * How the degradation fit used a lap (spec 4.1), one type for a session's stint (`stintAnalysis.car`) and a calibration
 * source's laps (`SourceFit.lapList`): `used`; `downWeighted` (slower than the prediction by more than the outlier
 * threshold); or excluded with the reason (not a `forPace` lap, an in- or out-lap, a neutralised lap). A unit's
 * judgement (C43): displays only show it (C65).
 */
export type LapUse = 'used' | 'downWeighted' | { excluded: 'notForPace' | 'inLap' | 'outLap' | 'neutralised' };

/** A set's priors entries by key (`<unit>.<name>[.<qualifier>…]`, declared with `definePriors`). */
export type PriorsEntries = Record<string, Known<number>>;

/** A calibration set's entries as the bridge hands them to a run (C62a), named by their fingerprint. */
export type PriorsSnapshot = {
  /** A hash of the whole snapshot (set id, set name, sources count and entries): two sets with equal entries are two snapshots. */
  fingerprint: string;
  setId: string;
  setName: string;
  /** How many sources the set pools. */
  sources: number;
  entries: PriorsEntries;
};

/** The run's priors (C62a): the session-start snapshot and every picked one, by fingerprint; also the priors sidecar's content. */
export type RunPriors = { start: string | null; snapshots: Record<string, PriorsSnapshot> };

/**
 * One source as the calibration panel shows it (spec 3.2, A23): its session's date, compound and laps, its own entries
 * (each declared `aggregate` over this one source) and their residuals against the set's (`residual`), and every lap
 * of the stint for the panel's lap list, so the panel computes nothing (C65). `skipped`: the
 * stint is no longer in its session's projection (`missing`) or the session awaits a rebuild (`stale`, C61); a skipped
 * source is left out of every aggregate.
 */
export type SourceFit = FittedSource | SkippedSource;

/** A source the store could read: its own values, residuals and laps. */
export type FittedSource = {
  source: CalibrationSource;
  /** ISO date of the source's session; shown only. */
  sessionDate: string;
  /** The source session's weekend phase (SESSION: race, FP2 …); shown only. */
  phase: WeekendPhase;
  /** The source car's driver name as the session's Participants last named it (CAR); shown only. */
  driver: Known<string>;
  compound: VisualCompound;
  laps: number;
  /** The laps the unit's aggregate used. */
  usedLaps: number;
  /**
   * Every lap of the stint: `excluded` when the user excluded it; `use` from the declaring unit's `lapUse` (C43),
   * `unknown('notApplicable')` when no unit declares one.
   */
  lapList: { lapNumber: number; lapTimeMs: Known<Ms>; excluded: boolean; use: Known<LapUse> }[];
  entries: PriorsEntries;
  residuals: Record<string, Known<number>>;
  skipped?: undefined;
};

/**
 * A source left out of every aggregate (C3: no placeholder values): `missing` (its stint or session is gone) or `stale`
 * (its session awaits a rebuild, C61). What is still known of it is `Known`; the rest it does not carry.
 */
export type SkippedSource = {
  source: CalibrationSource;
  skipped: 'missing' | 'stale';
  sessionDate: Known<string>;
  phase: Known<WeekendPhase>;
  driver: Known<string>;
  compound: Known<VisualCompound>;
};

/** `calibration.sets`: every calibration set, of all tracks. */
export type CalibrationSetsValue = { sets: CalibrationSet[] };
/** `calibration.values`: per set id its entries and its sources' fits. */
export type CalibrationValuesValue = {
  bySet: Record<string, {
    entries: PriorsEntries;
    fits: SourceFit[];
    /**
     * Per key whose entry is unknown (no source covers it): the unit's declared fallback over the set's track file and
     * the effective config, with its default source (the `ᵈ` values of the calibration panel).
     */
    defaults: Record<string, { value: Known<number>; source: EstimateSource }>;
  }>;
};
/** `calibration.candidates`: per track id the suggested sources, ordered (this weekend first, then newest first). */
export type CalibrationCandidatesValue = {
  byTrack: Record<number, SourceFit[]>;
  /** The track of the newest stored session, the calibration panel's track without a running session; `null` when none is stored. */
  newestTrackId: number | null;
};
/**
 * `calibration.active` (per feed): the run's set (`null` for `defaults`) and snapshot, and whether it came from a pick
 * (`picked`) or the preselection; `notApplicable` without a running session.
 */
export type CalibrationActiveValue = Known<{
  sessionUid: SessionUid;
  trackId: number;
  setId: string | null;
  setName: string;
  snapshot: string | null;
  picked: boolean;
}>;
