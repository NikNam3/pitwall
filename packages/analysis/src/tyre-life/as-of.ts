// `tyre-life` "as of frame N" (SP4.3a spec 6.1, Task 15c, ruling R16; SP4.3c Task 12): the calculator's output from the
// projection cut at N and the situation at N, with `tyre-model`'s output. Per car its set now is the one its newest lap
// ran on (unless a stint record reaches that lap: a new set no lap has run on yet), and its wear is the newest lap's end
// wear; the game's life span exists only in the live state (`unknown('notReceived')`). The scheduled run is this form
// on `asOfNow(view)` with the live state's set and wear and `tyre-model`'s life span (`calculator.ts`).
import { NOISE_COMPOUNDS, unknown, type CarId, type Corners, type Known, type LapRecord, type NoiseCompound, type TyreModelCar, type TyreModelOutput, type VisualCompound } from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { configOf } from '../shared/config-of.ts';
import { lapsByCar } from '../shared/stint-laps.ts';
import { lapsToLimitOf } from '../shared/tyre-prior.ts';
import { TYRE_MODEL_CONFIG } from '../tyre-model/config.ts';
import { TYRE_MODEL } from '../tyre-model/id.ts';
import { TYRE_LIFE_BEHAVIOUR, type TyreLifeEffect } from './behaviour.ts';
import type { TyreLife, TyreLifeOutput } from './types.ts';

type Corner = 'fl' | 'fr' | 'rl' | 'rr';
type CornerLife = TyreLife['corners']['fl'];

/** A car's tyres now, as the form reads them: the fitted set's compound (`undefined`: a set no recorded lap ran on), its wear per corner, its game life span. */
export type TyresNow = {
  compound: VisualCompound | undefined;
  wearPct: Corners<DeepReadonly<Known<number>>>;
  gameLifeSpanLaps: (model: DeepReadonly<TyreModelCar> | undefined) => Known<number>;
};

const isNoise = (c: VisualCompound | undefined): c is NoiseCompound => c !== undefined && (NOISE_COMPOUNDS as readonly string[]).includes(c);

/** Each car's rows (`TYRE_LIFE_BEHAVIOUR`) of the spans open for it, merged, by car id. */
function effectsByCar(view: AsOfView): Map<CarId, TyreLifeEffect> {
  const effects = new Map<CarId, TyreLifeEffect>();
  for (const [machine, byKind] of Object.entries(TYRE_LIFE_BEHAVIOUR)) {
    for (const span of view.situation.byMachine[machine] ?? []) {
      if (span.carId === undefined) continue;
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      effects.set(span.carId, { ...effects.get(span.carId), ...byKind[span.kind] });
    }
  }
  return effects;
}

/**
 * Per car of `cars` in the session (its rows, `TYRE_LIFE_BEHAVIOUR`), with its tyres now (`tyresOf`): per corner the
 * wear, `tyre-model`'s rate for the fitted compound and the laps until `tyre-model`'s limit (0 at or past it); the
 * set's laps to the limit (`tyre-model`'s `fittedLapsToLimit`, C43) and the game's life span.
 */
export function tyreLifeOf(view: AsOfView, cars: readonly CarId[], tyresOf: (car: CarId, laps: readonly LapRecord[]) => TyresNow): TyreLifeOutput {
  const effects = effectsByCar(view);
  const model = (view.outputs.get(TYRE_MODEL) as DeepReadonly<TyreModelOutput> | undefined) ?? {};
  const lapsOf = lapsByCar(view.history);
  const out: Record<CarId, TyreLife> = {};
  for (const id of cars) {
    if (effects.get(id)?.inSession !== true) continue;
    const tyres = tyresOf(id, lapsOf.get(id) ?? []);
    const car = model[id];
    // the limit in force is tyre-model's (its car's, else its config key, C47); without its car no laps to it (C3)
    const limitPct = car?.limitPct ?? configOf(TYRE_MODEL_CONFIG, view).limitPct;
    const terms = car !== undefined && isNoise(tyres.compound) ? car.compounds[tyres.compound] : undefined;
    const corner = (c: Corner): CornerLife => {
      const wearPct = tyres.wearPct[c] as Known<number>;
      const rate = (terms?.wearRatePct[c].value as Known<number> | undefined) ?? unknown('insufficientData');
      const lapsToLimit = car === undefined ? unknown('insufficientData') : lapsToLimitOf(wearPct, rate, car.limitPct);
      return { wearPct, ratePctPerLap: rate, lapsToLimit };
    };
    out[id] = {
      corners: { fl: corner('fl'), fr: corner('fr'), rl: corner('rl'), rr: corner('rr') },
      lapsToLimit: (car?.fittedLapsToLimit as Known<number> | undefined) ?? unknown('insufficientData'),
      limitPct,
      gameLifeSpanLaps: tyres.gameLifeSpanLaps(car),
    };
  }
  return out;
}

const NO_LAP = unknown('notReceived');

/**
 * Whether the car's newest stint record ends at a fitting after its newest lap (a stop whose in lap is the newest lap,
 * or a later one): the set fitted now is one no recorded lap ran on. The session's end closes a stint at the newest
 * lap, which is no in lap, and fits no set.
 */
export function refittedAfter(view: Pick<AsOfView, 'history'>, car: CarId, newest: LapRecord | undefined): boolean {
  if (newest === undefined) return false;
  const stint = view.history.stints.findLast((s) => s.carId === car);
  return stint !== undefined && (stint.lastLap > newest.lapNumber || (stint.lastLap === newest.lapNumber && newest.inLap));
}

/**
 * A car's tyres as of the projection: the compound of its newest lap, unless a set no recorded lap ran on is fitted
 * (`refittedAfter`); the wear at the newest lap's end; no game life span.
 */
function tyresAsOf(view: AsOfView, car: CarId, laps: readonly LapRecord[]): TyresNow {
  const newest = laps.at(-1);
  if (newest === undefined) return { compound: undefined, wearPct: { fl: NO_LAP, fr: NO_LAP, rl: NO_LAP, rr: NO_LAP }, gameLifeSpanLaps: () => NO_LAP };
  return { compound: refittedAfter(view, car, newest) ? undefined : newest.visualCompound, wearPct: newest.wearAtEndPct, gameLifeSpanLaps: () => NO_LAP };
}

/** The cars with a car-status span open at the view's frame (C17): the cars of the session. */
const carsOf = (view: AsOfView): CarId[] => [...new Set((view.situation.byMachine['car-status'] ?? []).flatMap((s) => (s.carId === undefined ? [] : [s.carId])))];

/** `tyre-life`'s output as of the view's frame. */
export function tyreLifeAsOf(view: AsOfView): TyreLifeOutput {
  return tyreLifeOf(view, carsOf(view), (car, laps) => tyresAsOf(view, car, laps));
}
