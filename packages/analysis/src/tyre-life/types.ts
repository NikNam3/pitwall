// `tyre-life`'s output types (spec 4.2), apart from the index so the unit's modules import them without a cycle.
import type { CarId, Corners, Known, Ms, Percent, VisualCompound } from '@pitwall/domain';

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
