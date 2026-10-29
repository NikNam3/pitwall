// Value type of the `tyre-wear` analysis (spec 5.1, A.3).
import type { Corners } from '../corners.ts';
import type { Known } from '../known.ts';
import type { Percent } from '../units.ts';

/** `tyreWear.car`: per corner the wear now, its rate over the stint's rate laps and the laps until the wear limit. */
export type TyreWear = {
  corners: Corners<{ wearPct: Known<Percent>; ratePctPerLap: Known<number>; lapsToLimit: Known<number> }>;
  /** The configured wear limit. */
  limitPct: Percent;
  /** Laps-to-limit below which the alarm fires; from the alarms config, so displays light up at the same threshold. */
  warnLaps: number;
  /** The fitted set's life span as the game states it (`TyreSet.lifeSpanLaps`): a reference marker, the game's figure. */
  gameLifeSpanLaps: Known<number>;
};
