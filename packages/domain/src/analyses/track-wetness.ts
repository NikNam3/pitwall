// Value type of the `track-wetness` calculator (SP4.3a spec 5.1): the field's common mode per lap and tyre type, and the filtered wetness state.
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';
import type { TyreType } from './crossover.ts';

export type TrackWetness = {
  /** Per completed leader lap: per tyre type the median free-air residual against the dry reference. */
  byLap: { lap: number; commonModeMs: Record<TyreType, Known<Ms>> }[];
  /** The filtered state: how much slower than its dry reference the field runs on slicks (ms; about 0 = dry), with its sd. */
  state: Known<{ wetnessMs: number; sdMs: number }>;
};
