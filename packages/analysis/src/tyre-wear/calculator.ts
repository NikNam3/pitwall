import { known, unknown, type CarId, type Corners, type Known, type TyreSet } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine';
import { ALARMS_CONFIG } from '../alarms/config.ts';
import { classifyLap } from '../lap-classes/index.ts';
import { lapsUntil, PER_LAP_RATE_CONFIG, perLapRate, type RateSample } from '../per-lap-rate/index.ts';
import { currentStintLaps } from '../shared/stint-laps.ts';
import { TYRE_WEAR, TYRE_WEAR_CONFIG, type TyreWear, type TyreWearOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** The fitted set's `lifeSpanLaps`, as of the `sets` value. */
function gameLifeSpan(sets: DeepReadonly<Known<{ sets: TyreSet[]; fittedIdx: number }>>): Known<number> {
  if (!sets.known) return sets;
  const fitted = sets.value.sets[sets.value.fittedIdx];
  return fitted === undefined ? unknown('notReceived') : known(fitted.lifeSpanLaps, sets.at);
}

/** Wear now, its rate over the current stint's rate laps and the laps until the wear limit, per corner and car. */
export const tyreWearCalculator: QuickCalculator<TyreWearOutput> = {
  id: TYRE_WEAR,
  kind: 'quick',
  reads: ['laps', 'stints', 'tyres'],
  cadence: { hz: 4 },
  compute: (view: EngineView): TyreWearOutput => {
    const { limitPct } = TYRE_WEAR_CONFIG.read(view);
    const { wearLapsWarning: warnLaps } = ALARMS_CONFIG.read(view);
    const rateOpts = PER_LAP_RATE_CONFIG.read(view);
    const isRace = view.state.session.kind === 'race';
    const out: Record<CarId, TyreWear> = {};
    for (const car of view.state.cars) {
      if (!car.active) continue;
      const own = currentStintLaps(view.state.history, car.id).filter((l) => classifyLap(l, { isRace }).forRate);
      const corner = (c: (typeof CORNERS)[number]): TyreWear['corners']['fl'] => {
        const wearPct = car.tyres.corners[c].wearPct;
        if (!wearPct.known) return { wearPct, ratePctPerLap: wearPct, lapsToLimit: wearPct };
        const samples: RateSample[] = [];
        for (const l of own) {
          const w = l.wearAtEndPct[c];
          if (w.known) samples.push({ lap: l.lapNumber, value: w.value, at: l.completedAt });
        }
        const rate = perLapRate(samples, rateOpts);
        return {
          wearPct,
          ratePctPerLap: rate.known ? known(rate.value.perLap, rate.at) : rate,
          lapsToLimit: lapsUntil(rate, wearPct.value, limitPct),
        };
      };
      const corners = Object.fromEntries(CORNERS.map((c) => [c, corner(c)])) as Corners<TyreWear['corners']['fl']>;
      out[car.id] = { corners, limitPct, warnLaps, gameLifeSpanLaps: gameLifeSpan(car.tyres.sets) };
    }
    return out;
  },
};
