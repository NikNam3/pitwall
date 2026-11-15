// `tyre-model` (SP4.3c spec §5.2, O1): a quick calculator (no topic, C42). Its scheduled run is the as-of form on
// `asOfNow(view)` with the live state's tyres in place of the projection's (the set fitted now, its wear and carcass
// now, the car's sets); the as-of form reads each car's newest lap record (its end wear, carcass mean and the sets the
// game gave then, Task 9), or the run's sets now where the view holds them (`fixed`).
import { unknown, type CarId, type CarState, type LapRecord, type TyreModelOutput, type TyreSet } from '@pitwall/domain';
import { asOfNow, type AsOfView, type DeepReadonly, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { TYRE_MODEL } from './id.ts';
import { carsOf, tyreModelOf, type CarSets, type TyresNow } from './model.ts';

const NO_LAP = unknown('notReceived');
const NONE = { fl: NO_LAP, fr: NO_LAP, rl: NO_LAP, rr: NO_LAP };

/** A lap record's sets as the live state holds them: the list and the fitted one's index. */
function lapSets(l: LapRecord): CarSets {
  const sets = l.tyreSets;
  if (!sets.known) return sets;
  return { known: true, value: { sets: sets.value as TyreSet[], fittedIdx: sets.value.findIndex((s) => s.fitted) }, at: sets.at };
}

/**
 * A car's tyres as of the projection: the set of its newest lap, aged one lap more than at that lap's start, unless the
 * car's newest stint record ends at a fitting after that lap (a set no recorded lap ran on); the wear and carcass that
 * lap recorded at its end; the sets it recorded (O1a: the projection, so a past build computes what the live run
 * computed), else, where the lap holds none, the sets the view holds now (`fixed`, a run's as-of view; a past one none).
 */
function tyresAsOf(view: AsOfView, car: CarId, laps: readonly LapRecord[]): TyresNow {
  const now = view.fixed.setsNow;
  const held: CarSets = now === null ? NO_LAP : (now[car] ?? NO_LAP);
  const newest = laps.at(-1);
  if (newest === undefined) return { set: undefined, wearPct: NONE, carcassC: NONE, sets: held };
  const stint = view.history.stints.findLast((s) => s.carId === car);
  const refitted = stint !== undefined && (stint.lastLap > newest.lapNumber || (stint.lastLap === newest.lapNumber && newest.inLap));
  const set = refitted ? undefined : { actualCompound: newest.actualCompound, visualCompound: newest.visualCompound, age: newest.tyreAgeAtStart + 1 };
  const recorded = lapSets(newest);
  const sets = recorded.known && recorded.value.sets.length > 0 ? recorded : now === null ? recorded : held;
  return { set, wearPct: newest.wearAtEndPct, carcassC: newest.carcassMeanC, sets };
}

/** `tyre-model`'s output as of the view's frame. */
export function tyreModelAsOf(view: AsOfView): TyreModelOutput {
  return tyreModelOf(view, carsOf(view), (car, laps) => tyresAsOf(view, car, laps));
}

/** A car's tyres as the live state holds them now. */
function tyresNow(tyres: DeepReadonly<CarState['tyres']>): TyresNow {
  const { corners } = tyres;
  return {
    set: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
    wearPct: { fl: corners.fl.wearPct, fr: corners.fr.wearPct, rl: corners.rl.wearPct, rr: corners.rr.wearPct },
    carcassC: { fl: corners.fl.carcassTempC, fr: corners.fr.carcassTempC, rl: corners.rl.carcassTempC, rr: corners.rr.carcassTempC },
    sets: tyres.sets,
  };
}

/** Per car in the session (its rows, `TYRE_MODEL_BEHAVIOUR`): per compound and corner its tyre terms with their sources. */
export const tyreModelCalculator: QuickCalculator<TyreModelOutput> = {
  id: TYRE_MODEL,
  kind: 'quick',
  // `session` and `identity`: what `asOfNow` reads for the as-of view's `fixed` (our cars)
  reads: [
    'tyres',
    'laps',
    'stints',
    'decisions',
    'drivers',
    'session',
    'identity',
    'spans:car-driver',
    'spans:car-activity-race',
    CAR_STATUS_READS,
    'spans:weekend-phase',
    { calculator: 'degradation' },
    { calculator: 'track-wetness' },
  ],
  cadence: { onChange: ['laps', 'tyres'] },
  compute: (view: EngineView): TyreModelOutput => {
    const asOf = asOfNow(view);
    const live = new Map(view.live.cars.map((c) => [c.id, c.tyres]));
    return tyreModelOf(asOf, carsOf(asOf), (car, laps) => {
      const tyres = live.get(car);
      return tyres === undefined ? tyresAsOf(asOf, car, laps) : tyresNow(tyres);
    });
  },
};
