// Value type of the `stint-analysis` analysis (spec 5): our cars' stints, laps and fitted degradation, for the stint scatter.
import type { LapUse } from '../calibration.ts';
import type { ActualCompound, VisualCompound } from '../compounds.ts';
import type { EstimateSource } from '../estimates.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/** One lap of a stint as the scatter plots it. */
export type StintLap = {
  lapNumber: number;
  tyreAge: number;
  lapTimeMs: Ms;
  /** The lap time minus the fuel's effect (`lapTimeMs − γ · fuelKg`); `unknown` when the fuel load cannot be known. */
  correctedMs: Known<Ms>;
  use: LapUse;
};

/** The fitted lap time at one tyre age and its band (one sd). */
export type FitPoint = { tyreAge: number; ms: Ms; sdMs: Ms };

/** One stint of a car with its fit (spec 4.1, 5). */
export type StintFit = {
  /** The car's stint, counted from 1. */
  stint: number;
  firstLap: number;
  lastLap: number;
  /** The compound, actual and visual (Q3). */
  actual: ActualCompound;
  visual: VisualCompound;
  basePaceMs: Known<Ms>;
  nuMsPerLap: Known<number>;
  nuSdMs: Known<number>;
  basis: 'wear' | 'age';
  /** `false` when the laps were fitted without the fuel correction (a rival's stint in practice or qualifying). */
  fuelCorrected: boolean;
  source: EstimateSource;
  laps: StintLap[];
  /** The fit line with its band per tyre age of the stint (Q12). */
  fitLine: Known<FitPoint[]>;
};

/** Per compound the prior a stint on it started from, with its source (calibration or default). */
export type CompoundPrior = {
  actual: ActualCompound;
  visual: VisualCompound;
  alphaOffsetMs: Known<Ms>;
  nuMsPerLap: Known<number>;
  nuSdMs: Known<number>;
  source: EstimateSource;
};

/** `stintAnalysis.car`: one of our cars' stints and the priors per compound; a rival is `unknown('notApplicable')`. */
export type StintAnalysis = Known<{ stints: StintFit[]; compounds: CompoundPrior[] }>;
