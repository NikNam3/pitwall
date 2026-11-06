// The output types of `degradation` (spec 4.1), re-exported by its index.
import type { ActualCompound, CarId, Corners, EstimateSource, Known, LapUse, Ms, VisualCompound } from '@pitwall/domain';

/** One lap of a stint as the filter used it. */
export type DegradationLap = { lapNumber: number; tyreAge: number; lapTimeMs: Ms; correctedMs: Known<Ms>; use: LapUse };

/**
 * One stint of a car: base pace `α` and degradation per lap `ν` with its sd, the basis (`wear` when the car's wear is
 * visible, else `age`), whether the laps are fuel-corrected, the wear rate per corner (`per-lap-rate`), the source of
 * the estimate (spec 4.4) and per lap how the filter used it.
 */
export type StintDegradation = {
  /** The car's stint, counted from 1. */
  stint: number;
  actual: ActualCompound;
  visual: VisualCompound;
  basePaceMs: Known<Ms>;
  nuMsPerLap: Known<number>;
  nuSdMs: Known<number>;
  basis: 'wear' | 'age';
  fuelCorrected: boolean;
  wearRatePctPerLap: Corners<Known<number>>;
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
