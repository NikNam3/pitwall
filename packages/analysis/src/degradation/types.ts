// The output types of `degradation` (spec 4.1), re-exported by its index.
import type { ActualCompound, CarId, EstimateSource, Known, LapUse, Ms, VisualCompound } from '@pitwall/domain';

/** One lap of a stint as the filter used it. */
export type DegradationLap = { lapNumber: number; tyreAge: number; lapTimeMs: Ms; correctedMs: Known<Ms>; use: LapUse };

/**
 * One stint of a car: base pace `α` and degradation per lap `ν` with its sd, the basis (`wear` when the car's wear is
 * visible, else `age`), whether the laps are fuel-corrected, the source of the estimate (spec 4.4) and per lap how the
 * filter used it. The wear rate is `tyre-model`'s (SP4.3c Task 12).
 */
export type StintDegradation = {
  /** The car's stint, counted from 1. */
  stint: number;
  /** The stint's first and last lap: a closed stint's from its stint record, the open stint's its first and newest lap. */
  firstLap: number;
  lastLap: number;
  actual: ActualCompound;
  visual: VisualCompound;
  /**
   * The car's pace on the stint at tyre age 0 (a car's pace is `degradation`'s, SP4.3c Task 13, O2): the filter's `α`;
   * for a car without any fitted stint, its newest stint takes the newest lap less its fuel term as its prior (`source`
   * parts `newest lap`, `cov` unknown).
   */
  basePaceMs: Known<Ms>;
  nuMsPerLap: Known<number>;
  nuSdMs: Known<number>;
  basis: 'wear' | 'age';
  fuelCorrected: boolean;
  /**
   * Whether `basePaceMs` holds the car's fuel (B9): it was taken from lap times without a fuel correction (fuel unknown).
   * A forecast then adds no fuel term on top of it.
   */
  fuelIncluded: boolean;
  source: EstimateSource;
  /** The filter's posterior covariance of `(α, ν)` after the stint's fitted laps; `insufficientData` below two (`fitStint`). */
  cov: Known<[[number, number], [number, number]]>;
  /** The prior the stint started from, with its source (`sessionShare` 0). */
  startPrior: StartPrior;
  laps: DegradationLap[];
};

/**
 * Where a stint's filter started: `ν`'s mean and sd, the `α` offset of the compound against medium (the calibration's
 * entry, or the track file's offset; `notApplicable` with the config default) and the prior's source.
 */
export type StartPrior = { nuMsPerLap: number; nuSdMs: number; alphaOffsetMs: Known<Ms>; source: EstimateSource };

/** The output: per car its stints, oldest first. */
export type DegradationOutput = Record<CarId, StintDegradation[]>;
