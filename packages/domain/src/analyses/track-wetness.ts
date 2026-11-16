// Value type of the `track-wetness` calculator (SP4.3a spec 5.1): the field's common mode per lap and tyre type, and the filtered wetness state.
import type { EstimateSource } from '../estimates.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';
import type { TyreType } from './crossover.ts';

export type TrackWetness = {
  /** Per completed leader lap: per tyre type the median free-air residual against the dry reference. */
  byLap: { lap: number; commonModeMs: Record<TyreType, Known<Ms>> }[];
  /** The filtered state: how much slower than its dry reference the field runs on slicks (ms; about 0 = dry), with its sd. */
  state: Known<{ wetnessMs: number; sdMs: number }>;
  /** The one wet rule (SP4.3c O3): the filtered wetness above zero by more than the configured sigmas of its sd. */
  wet: Known<boolean>;
  /** The dry slick reference lap time the residuals are measured against; `insufficientData` while none is known. */
  dryRefMs: Known<Ms>;
  /** Where the dry reference comes from (this session's slick laps, the calibration set's priors entry, a default). */
  dryRefSource: EstimateSource;
  /** The slick scale from the lap model's parameters (replaces the dry reference's private offsets). */
  slickScale: Known<number>;
};
