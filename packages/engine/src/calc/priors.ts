// Priors declarations and `view.priors` (contract C62a, spec 3.2, 3.4): each estimation unit declares its priors entries
// with pure functions over a set's sources; the bridge's priors store runs them between runs; the scheduler gives a run
// the snapshot the projection's decisions name.
import {
  known,
  unknown,
  type CalibrationSource,
  type DecisionRecord,
  type Known,
  type LapRecord,
  type LapUse,
  type PitStopRecord,
  type PriorsEntries,
  type PriorsSnapshot,
  type RunPriors,
  type StintRecord,
  type TrackData,
  type WeekendPhase,
} from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { EngineView } from './types.ts';

/**
 * A calibration source as an aggregate reads it, from its session's stored projection (C34): the stint with its laps
 * (minus the excluded ones), its session's weekend phase, every car's stops and current laps, and the session's track
 * file. `laps` is the source stint's laps; `sessionLaps` every car's current laps of the session (a stop's loss needs
 * the car's reference laps, in-lap and out-lap, spec 4.3).
 */
export type StoredSource = {
  source: CalibrationSource;
  phase: WeekendPhase;
  stint: StintRecord;
  laps: LapRecord[];
  pitStops: PitStopRecord[];
  sessionLaps: LapRecord[];
  track: Known<DeepReadonly<TrackData>>;
};

/** What a priors function reads besides its sources: the effective config (C47), so it uses the unit's thresholds, and the set's overrides. */
export type PriorsCtx = { config: EngineView['config']; overrides: Readonly<Record<string, number>> };

/** One priors entry: its aggregate's version, the range an override must lie in, and its pure functions. */
export type PriorDecl = {
  /** Bumped when `aggregate` changes, so the store recomputes the entry (C62a). */
  version: number;
  /** The inclusive range of the entry's value; an override outside it is rejected (C73). */
  range: readonly [min: number, max: number];
  /** Absent for an override-only key (`tyreLife.wearLimitPct`): unknown unless the set overrides it. */
  aggregate?(sources: readonly StoredSource[], ctx: PriorsCtx): Known<number>;
  /** A source's own entries against the set's (spec 3.2, A23). */
  residual?(source: PriorsEntries, set: PriorsEntries): Known<number>;
};

/**
 * A unit's priors declaration: its entries by key, which stints it suggests as sources (`candidate`) and how its
 * aggregate uses each lap of a source (`lapUse`).
 */
export type PriorsDecl = {
  unit: string;
  entries: Record<string, PriorDecl>;
  candidate?(source: StoredSource, ctx: PriorsCtx): boolean;
  /**
   * Per lap number of the source's stint, how the unit's aggregate uses the lap (C43). The store copies it into
   * `SourceFit.lapList`; a source without any unit's `lapUse` gets `unknown('notApplicable')` per lap.
   */
  lapUse?(source: StoredSource, ctx: PriorsCtx): Record<number, LapUse>;
};

/** Declares a unit's priors entries; a feature lists it in its `priors` (C63), as it lists its config. */
export function definePriors(unit: string, decl: Omit<PriorsDecl, 'unit'>): PriorsDecl {
  return { unit, ...decl };
}

/**
 * The time a chosen snapshot is known from: fixed per snapshot, so `view.priors` stays equal from frame to frame and
 * after a rewind (C33, C38); a decision records no race-clock time to use instead.
 */
const PRIORS_AT = 0;

/**
 * `view.priors` (C62a): the snapshot of the newest `calibrationChosen` in `decisions`, else `run.start`'s;
 * `notApplicable` without one (no set, `defaults` chosen, a recording without a priors sidecar) and when the chosen
 * snapshot is not among the run's.
 */
export function priorsOf(decisions: readonly DeepReadonly<DecisionRecord>[], run: DeepReadonly<RunPriors>): Known<DeepReadonly<PriorsSnapshot>> {
  const chosen = decisions.findLast((d) => d.kind === 'calibrationChosen');
  const fingerprint = chosen === undefined ? run.start : chosen.setId === null ? null : chosen.snapshot;
  const snapshot = fingerprint === null ? undefined : run.snapshots[fingerprint];
  return snapshot === undefined ? unknown('notApplicable') : known(snapshot, PRIORS_AT);
}
