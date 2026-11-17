// Value type of the `tyre-model` calculator (SP4.3c spec O1): per car and compound the tyre terms every planner and
// forecast reads, each with where it comes from.
import type { Corners } from '../corners.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';
import type { TyreType } from './crossover.ts';
import type { NoiseCompound } from './driver-noise.ts';

/** Where a tyre term comes from: the car's own laps, its driver's profile, the game's tyre sets, or the default. */
export type TyreSource = 'measured' | 'profile' | 'game' | 'default';

/** One term of the tyre model with its source. */
export type TyreTerm<T> = { value: Known<T>; source: TyreSource };

/** One compound's terms for one car. */
export type TyreModelCompound = {
  /** Wear per lap per corner, in %. */
  wearRatePct: Corners<TyreTerm<number>>;
  /** Pace loss per lap of tyre life (ν), in ms per lap. */
  nuMsPerLap: TyreTerm<number>;
  /** Pace loss per % of wear, in ms. */
  lossMsPerPct: TyreTerm<number>;
  /** A fresh set's pace offset against the fitted set. */
  freshOffsetMs: TyreTerm<Ms>;
  /** Laps on a fresh set until the wear limit (`limitPct`). */
  lapsToLimit: Known<number>;
};

/** One car's tyre model. */
export type TyreModelCar = {
  compounds: Record<NoiseCompound, TyreModelCompound>;
  /** The best fresh set's pace delta per tyre type, against the fitted set. */
  typeDeltaMs: Record<TyreType, Known<Ms>>;
  /** Available fresh sets per compound; a rival's `unknown('realism')`. */
  freshSets: Record<NoiseCompound, Known<number>>;
  /** The wear limit no stint is planned past, in %. */
  limitPct: number;
  /** Laps the fitted set has left until `limitPct` from its current wear (the compounds' `lapsToLimit` are a fresh set's); 0 at or past it. */
  fittedLapsToLimit: Known<number>;
  /**
   * The compound of the fitted set (the game's visual compound); a car without its sets `unknown`. Set by `tyre-model`
   * from SP4.3d2 Task 7 (the race's grid start reads it); absent reads as `unknown('notReceived')`.
   */
  fittedCompound?: Known<NoiseCompound>;
  /** The fitted set's life span as the game states it (`TyreSet.lifeSpanLaps`). */
  fittedLifeSpanLaps: Known<number>;
  /** Our car's used sets left with their wear (the starting point's `sets`); a rival's `unknown('notApplicable')`. */
  usedSets: Known<{ compound: NoiseCompound; wearPct: number }[]>;
};

/** `tyre-model`'s output: every car's model. */
export type TyreModelOutput = Record<CarId, TyreModelCar>;
