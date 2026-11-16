// `tyre-life` (spec 4.2; SP4.3c Task 12): a reader of `tyre-model`. Per car in the session, per corner the wear now,
// `tyre-model`'s rate for the fitted compound and the laps until `tyre-model`'s limit; the set's laps to the limit and
// the game's life span of the fitted set, both `tyre-model`'s (C43: tyre-life judges no second one). The scheduled run is
// the as-of form on `asOfNow(view)` (Task 15c, ruling R16) with the live state's compound and wear (mid-lap).
import type { CarState, Known } from '@pitwall/domain';
import { asOfNow, type DeepReadonly, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { TYRE_MODEL } from '../tyre-model/id.ts';
import { refittedAfter, tyreLifeOf, type TyresNow } from './as-of.ts';
import { TYRE_LIFE } from './index.ts';
import type { TyreLifeOutput } from './types.ts';

const NOT_RECEIVED: Known<number> = { known: false, reason: 'notReceived' };

/**
 * A car's tyres as the live state holds them now; the life span `tyre-model`'s. A set fitted at a stop no recorded lap
 * ran on yet has no rate here (`refittedAfter`, as the as-of form: the rate is of a set the projection shows).
 */
function tyresNow(tyres: DeepReadonly<CarState['tyres']>, refitted: boolean): TyresNow {
  const { corners } = tyres;
  return {
    compound: refitted ? undefined : tyres.visualCompound,
    wearPct: { fl: corners.fl.wearPct, fr: corners.fr.wearPct, rl: corners.rl.wearPct, rr: corners.rr.wearPct },
    gameLifeSpanLaps: (model) => (model?.fittedLifeSpanLaps as Known<number> | undefined) ?? NOT_RECEIVED,
  };
}

/** Per car in the session (its rows, `TYRE_LIFE_BEHAVIOUR`): its set's wear, rates and laps to the limit, from `tyre-model`. */
export const tyreLifeCalculator: QuickCalculator<TyreLifeOutput> = {
  id: TYRE_LIFE,
  kind: 'quick',
  // `laps` and `stints`: what the as-of form reads for a car's set and wear (the newest lap, a fitting after it)
  reads: ['tyres', 'laps', 'stints', CAR_STATUS_READS, { calculator: TYRE_MODEL }],
  cadence: { hz: 4 },
  compute: (view: EngineView): TyreLifeOutput => {
    const tyres = new Map(view.live.cars.map((c) => [c.id, c.tyres]));
    const asOf = asOfNow(view);
    return tyreLifeOf(asOf, [...tyres.keys()], (id, laps) => tyresNow(tyres.get(id) as DeepReadonly<CarState['tyres']>, refittedAfter(asOf, id, laps.at(-1))));
  },
};
