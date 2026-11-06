// `tyre-life` (spec 4.2): laps until the current set reaches its limit, and the fresh-set life per compound, from the
// wear rates (wear basis) or `degradation`'s `ν` (age basis). A calculator: no topic; `tyre-wear` publishes from it.
import type { CarId, Corners, Known, Ms, Percent, VisualCompound } from '@pitwall/domain';

export * from './behaviour.ts';
export * from './config.ts';
export * from './priors.ts';

/** The calculator id. */
export const TYRE_LIFE = 'tyre-life';

/**
 * One car's set: per corner the wear now, its rate and the laps until the limit; the laps until the worst corner (wear
 * basis) or until `ν · age` reaches `ageLossLimitMs` (age basis); the limits in force; the fresh-set life per compound;
 * the game's life span of the fitted set.
 */
export type TyreLife = {
  corners: Corners<{ wearPct: Known<Percent>; ratePctPerLap: Known<number>; lapsToLimit: Known<number> }>;
  lapsToLimit: Known<number>;
  basis: 'wear' | 'age';
  limitPct: number;
  ageLossLimitMs: Ms;
  freshLifeLaps: Record<VisualCompound, Known<number>>;
  gameLifeSpanLaps: Known<number>;
};

/** The output: per car its set. */
export type TyreLifeOutput = Record<CarId, TyreLife>;
