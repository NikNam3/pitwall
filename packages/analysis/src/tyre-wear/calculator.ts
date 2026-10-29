import { known, unknown, type CarId, type Corners, type Known, type LapRecord, type StintRecord, type TyreSet } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { lapsUntil, PER_LAP_RATE_CONFIG, perLapRate, type RateSample } from '../per-lap-rate/index.ts';
import { TYRE_WEAR, TYRE_WEAR_CONFIG, type TyreWear, type TyreWearOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/**
 * The laps of the car's current stint. `history.stints` holds closed stints only: after the last record the open stint
 * starts at its `lastLap + 1`; a record that reaches the newest lap (the session ended) is the current stint.
 */
function currentStintLaps(laps: DeepReadonly<LapRecord[]>, stints: DeepReadonly<StintRecord[]>): DeepReadonly<LapRecord[]> {
  const last = stints[stints.length - 1];
  if (last === undefined) return laps;
  const newest = laps.reduce((n, l) => Math.max(n, l.lapNumber), 0);
  const first = last.lastLap >= newest ? last.firstLap : last.lastLap + 1;
  return laps.filter((l) => l.lapNumber >= first);
}

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
    const rateOpts = PER_LAP_RATE_CONFIG.read(view);
    const isRace = view.state.session.kind === 'race';
    const { laps, stints } = view.state.history;
    const out: Record<CarId, TyreWear> = {};
    for (const car of view.state.cars) {
      if (!car.active) continue;
      const own = currentStintLaps(
        laps.filter((l) => l.carId === car.id),
        stints.filter((s) => s.carId === car.id),
      ).filter((l) => classifyLap(l as LapRecord, { isRace }).forRate);
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
      out[car.id] = { corners, limitPct, gameLifeSpanLaps: gameLifeSpan(car.tyres.sets) };
    }
    return out;
  },
};
