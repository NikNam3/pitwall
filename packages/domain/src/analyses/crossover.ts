// Value type of the `crossover` analysis (spec 3.4, V19): the field's lap times per tyre type against our car's.
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms, Percent } from '../units.ts';

/** A lap's tyre type: a C-compound is `slick`; the game's wet compounds are `wet`. */
export type TyreType = 'slick' | 'inter' | 'wet';

/** Per lap number, the median of the field's green laps of each type. */
export type CrossoverLap = { lapNumber: number; medianMs: Record<TyreType, Known<Ms>> };

/** The first car on a type other than ours whose sector beat our car's same sector on the same lap number. */
export type FirstFaster = { carId: CarId; type: TyreType; sector: 1 | 2 | 3; lapNumber: number };

/** `crossover.car`: for one of our cars (race only, spec B8). */
export type Crossover = {
  ourType: Known<TyreType>;
  byLap: CrossoverLap[];
  dryRefMs: Known<Ms>;
  line110Ms: Known<Ms>;
  ourPct: Known<Percent>;
  firstFaster: Known<FirstFaster>;
  payback: Known<{ laps: number; lossSource: EstimateSource }>;
};
