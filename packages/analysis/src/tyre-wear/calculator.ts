import { carId, known, type CarId, type Known, type Percent, type TyreWear } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { ALARMS_CONFIG } from '../alarms/config.ts';
import { TYRE_LIFE, type TyreLifeOutput } from '../tyre-life/index.ts';
import { TYRE_WEAR, type TyreWearOutput } from './index.ts';

/**
 * The wear a corner reaches at the game's life span (B1): its rate × the life span, at the rate's time; unknown with the
 * rate's reason while the rate is unknown, else with the life span's.
 */
const atLifeSpan = (rate: Known<number>, lifeSpan: Known<number>): Known<Percent> =>
  !rate.known ? rate : !lifeSpan.known ? lifeSpan : known(rate.value * lifeSpan.value, rate.at);

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
      const corners = life.corners as TyreWear['corners'];
      const lifeSpan = life.gameLifeSpanLaps as TyreWear['gameLifeSpanLaps'];
      out[carId(Number(id))] = {
        corners,
        limitPct: life.limitPct,
        warnLaps,
        gameLifeSpanLaps: lifeSpan,
        wearAtLifeSpanPct: {
          fl: atLifeSpan(corners.fl.ratePctPerLap, lifeSpan),
          fr: atLifeSpan(corners.fr.ratePctPerLap, lifeSpan),
          rl: atLifeSpan(corners.rl.ratePctPerLap, lifeSpan),
          rr: atLifeSpan(corners.rr.ratePctPerLap, lifeSpan),
        },
      };
    }
    return out;
  },
};
