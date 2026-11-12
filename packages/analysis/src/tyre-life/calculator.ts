// `tyre-life` (spec 4.2): per car in the session, the laps until its set reaches its limit, on the wear basis (per corner
// at its wear rate, the worst corner limiting) when the car's wear is visible, else on the age basis (`degradation`'s
// `ν`); and the fresh-set life per compound. The limits are the config's unless the run's calibration set overrides them.
// The scheduled run is the as-of form on `asOfNow(view)` (Task 15c, ruling R16) with the live state's tyres in place of
// the projection's: the set fitted now, the wear now (mid-lap) and the set's `lifeSpanLaps`.
import { known, unknown, type CarState, type Known, type TyreSet } from '@pitwall/domain';
import { asOfNow, type DeepReadonly, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { tyreLifeOf, type TyresNow } from './as-of.ts';
import { TYRE_LIFE } from './index.ts';
import type { TyreLifeOutput } from './types.ts';

/** The fitted set's `lifeSpanLaps`, as of the `sets` value. */
function gameLifeSpan(sets: DeepReadonly<Known<{ sets: TyreSet[]; fittedIdx: number }>>): Known<number> {
  if (!sets.known) return sets;
  const fitted = sets.value.sets[sets.value.fittedIdx];
  return fitted === undefined ? unknown('notReceived') : known(fitted.lifeSpanLaps, sets.at);
}

/** A car's tyres as the live state holds them now. */
function tyresNow(tyres: DeepReadonly<CarState['tyres']>): TyresNow {
  const { corners } = tyres;
  return {
    set: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
    wearPct: { fl: corners.fl.wearPct, fr: corners.fr.wearPct, rl: corners.rl.wearPct, rr: corners.rr.wearPct },
    gameLifeSpanLaps: gameLifeSpan(tyres.sets),
  };
}

/**
 * Per car in the session (its rows, `TYRE_LIFE_BEHAVIOUR`): wear now, its rate (the median of the rate laps' own wear
 * gains, over the current stint's laps on the fitted set) and the laps until the wear limit (0 at or past it) per corner;
 * the set's laps to its limit on its basis (each `insufficientData` before the current stint has run `minLaps` laps); the fresh-set life per compound; the game's life span of the fitted set.
 */
export const tyreLifeCalculator: QuickCalculator<TyreLifeOutput> = {
  id: TYRE_LIFE,
  kind: 'quick',
  reads: ['laps', 'stints', 'tyres', 'decisions', CAR_STATUS_READS, { calculator: 'degradation' }],
  cadence: { hz: 4 },
  compute: (view: EngineView): TyreLifeOutput => {
    const tyres = new Map(view.live.cars.map((c) => [c.id, c.tyres]));
    return tyreLifeOf(asOfNow(view), [...tyres.keys()], (id) => tyresNow(tyres.get(id) as DeepReadonly<CarState['tyres']>));
  },
};
