// `tyre-life`'s output types (spec 4.2; SP4.3c Task 12), apart from the index so the unit's modules import them without a cycle.
import type { CarId, Corners, Known, Percent } from '@pitwall/domain';

/**
 * One car's set: per corner the wear now, its rate and the laps until the limit (`tyre-model`'s rate and limit); the
 * set's laps until the limit and the game's life span of the fitted set (both `tyre-model`'s); the limit in force.
 */
export type TyreLife = {
  corners: Corners<{ wearPct: Known<Percent>; ratePctPerLap: Known<number>; lapsToLimit: Known<number> }>;
  lapsToLimit: Known<number>;
  limitPct: number;
  gameLifeSpanLaps: Known<number>;
};

/** The output: per car its set. */
export type TyreLifeOutput = Record<CarId, TyreLife>;
