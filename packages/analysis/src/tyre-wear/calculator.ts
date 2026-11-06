import { carId, type CarId, type TyreWear } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { ALARMS_CONFIG } from '../alarms/config.ts';
import { TYRE_LIFE, type TyreLifeOutput } from '../tyre-life/index.ts';
import { TYRE_WEAR, type TyreWearOutput } from './index.ts';

/**
 * `tyreWear.car` per car of `tyre-life`'s output (spec 4.2, the port): its corners (wear, rate, laps to the limit), its
 * wear limit and the game's life span as `tyre-life` judged them (C43), with the alarms' `warnLaps`. A car without a
 * `tyre-life` entry has none.
 */
export const tyreWearCalculator: QuickCalculator<TyreWearOutput> = {
  id: TYRE_WEAR,
  kind: 'quick',
  reads: [{ calculator: TYRE_LIFE }],
  cadence: { hz: 4 },
  compute: (view: EngineView): TyreWearOutput => {
    const { wearLapsWarning: warnLaps } = ALARMS_CONFIG.read(view);
    const tyreLife = (view.outputs.get(TYRE_LIFE) as DeepReadonly<TyreLifeOutput> | undefined) ?? {};
    const out: Record<CarId, TyreWear> = {};
    for (const [id, life] of Object.entries(tyreLife)) {
      out[carId(Number(id))] = {
        corners: life.corners as TyreWear['corners'],
        limitPct: life.limitPct,
        warnLaps,
        gameLifeSpanLaps: life.gameLifeSpanLaps as TyreWear['gameLifeSpanLaps'],
      };
    }
    return out;
  },
};
