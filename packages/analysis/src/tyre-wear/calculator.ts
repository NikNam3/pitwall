import { known, unknown, type CarId, type CarState, type Corners, type Known, type LapRecord, type TyreSet } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { ALARMS_CONFIG } from '../alarms/config.ts';
import { classifyLap, LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { lapsToReach, PER_LAP_RATE_CONFIG, perLapGainRate, type GainSample } from '../per-lap-rate/index.ts';
import { currentStintLaps } from '../shared/stint-laps.ts';
import { TYRE_WEAR, TYRE_WEAR_CONFIG, type TyreWear, type TyreWearOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** The fitted set's `lifeSpanLaps`, as of the `sets` value. */
function gameLifeSpan(sets: DeepReadonly<Known<{ sets: TyreSet[]; fittedIdx: number }>>): Known<number> {
  if (!sets.known) return sets;
  const fitted = sets.value.sets[sets.value.fittedIdx];
  return fitted === undefined ? unknown('notReceived') : known(fitted.lifeSpanLaps, sets.at);
}

/**
 * The laps (oldest first) that ran on the fitted set: the newest of `laps` back to the first that was not on it. A lap on
 * another compound, or with more laps on its set than a newer lap of the run (or than the fitted set now), was on
 * another set. So a set fitted before its stint is recorded (a stop whose in lap is the newest lap, a garage visit)
 * has no samples from the set before it.
 */
function onFittedSet(laps: readonly LapRecord[], tyres: DeepReadonly<CarState['tyres']>): LapRecord[] {
  let age = tyres.age;
  let first = laps.length;
  while (first > 0) {
    const l = laps[first - 1] as LapRecord;
    if (l.actualCompound !== tyres.actualCompound || l.visualCompound !== tyres.visualCompound || l.tyreAgeAtStart > age) break;
    age = l.tyreAgeAtStart;
    first--;
  }
  return laps.slice(first);
}

/**
 * Wear now, its rate (the median of the rate laps' own wear gains, over the current stint's laps on the fitted set) and
 * the laps until the wear limit (0 at or past it), per corner and car.
 */
export const tyreWearCalculator: QuickCalculator<TyreWearOutput> = {
  id: TYRE_WEAR,
  kind: 'quick',
  reads: ['laps', 'stints', 'tyres'],
  cadence: { hz: 4 },
  compute: (view: EngineView): TyreWearOutput => {
    const { limitPct } = TYRE_WEAR_CONFIG.read(view);
    const { wearLapsWarning: warnLaps } = ALARMS_CONFIG.read(view);
    const rateOpts = PER_LAP_RATE_CONFIG.read(view);
    const classes = { isRace: view.live.session.kind === 'race', ...LAP_CLASSES_CONFIG.read(view) };
    const out: Record<CarId, TyreWear> = {};
    for (const car of view.live.cars) {
      if (!car.active) continue;
      const own = onFittedSet(
        currentStintLaps(view.history, car.id).filter((l) => classifyLap(l, classes).forRate),
        car.tyres,
      );
      const corner = (c: (typeof CORNERS)[number]): TyreWear['corners']['fl'] => {
        const wearPct = car.tyres.corners[c].wearPct;
        if (!wearPct.known) return { wearPct, ratePctPerLap: wearPct, lapsToLimit: wearPct };
        const samples: GainSample[] = [];
        for (const l of own) {
          const start = l.wearAtStartPct[c];
          const end = l.wearAtEndPct[c];
          if (start.known && end.known) samples.push({ lap: l.lapNumber, gain: end.value - start.value, at: l.completedAt });
        }
        const rate = perLapGainRate(samples, rateOpts);
        return {
          wearPct,
          ratePctPerLap: rate.known ? known(rate.value.perLap, rate.at) : rate,
          lapsToLimit: lapsToReach(rate, wearPct, limitPct, 'rising'),
        };
      };
      const corners = Object.fromEntries(CORNERS.map((c) => [c, corner(c)])) as Corners<TyreWear['corners']['fl']>;
      out[car.id] = { corners, limitPct, warnLaps, gameLifeSpanLaps: gameLifeSpan(car.tyres.sets) };
    }
    return out;
  },
};
