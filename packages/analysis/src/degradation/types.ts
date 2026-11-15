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
   * parts `newest lap`, `cov` unknown). A car without any lap has no stint (its stand-in is the output's `standIn`).
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

/**
 * The field's stand-in for a car without any completed lap (SP4.3c Task 13, R47): the lap `lapNumber` of the car
 * `fromCarId` (the car with the most laps, the first to complete its newest; `degradation`'s judgement, C43). Its base
 * pace is that lap less its fuel term plus `noLapStandInOffsetMs`, the lap time itself where its fuel is unknown
 * (`fuelIncluded`); the default `ν` and its sd; the lap's visual compound; its source names the stand-in.
 */
export type LeaderStandIn = {
  fromCarId: CarId;
  lapNumber: number;
  basePaceMs: Ms;
  fuelIncluded: boolean;
  nuMsPerLap: number;
  nuSdMs: number;
  compound: VisualCompound;
  source: EstimateSource;
};

/**
 * The output: per car its stints of the laps it drove, oldest first; and the field's stand-in for a car without a lap,
 * known only while the leading lap is lap 1 and a car in the session has no lap, else `notApplicable`.
 */
export type DegradationOutput = { stints: Record<CarId, StintDegradation[]>; standIn: Known<LeaderStandIn> };
