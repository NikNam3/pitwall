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
  laps: DegradationLap[];
};

/** The output: per car its stints, oldest first. */
export type DegradationOutput = Record<CarId, StintDegradation[]>;
