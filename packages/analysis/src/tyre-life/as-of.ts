// `tyre-life` "as of frame N" (SP4.3a spec 6.1, Task 15c, ruling R16): the calculator's output from the projection cut at
// N and the situation at N, with the run's fixed inputs. Per car its set now is the one its newest lap ran on (unless a
// stint record reaches that lap: a new set no lap has run on yet), and its wear is the newest lap's end wear; the game's
// life span exists only in the live state (`unknown('notReceived')`). The scheduled run is this form on `asOfNow(view)`
// with the live state's set, wear and life span in place of the projection's (`tyreLifeOf`, the calculator).
import { currentLaps, known, unknown, type CarId, type Corners, type Known, type LapRecord, type Ms, type Percent, type VisualCompound } from '@pitwall/domain';
import type { AsOfView, DeepReadonly, EngineView } from '@pitwall/engine/readers';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../degradation/index.ts';
import { priorKey } from '../degradation/priors.ts';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { lapsToReach, PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { currentStintLaps } from '../shared/stint-laps.ts';
import { CORNERS, wearBasis, wearRatePerCorner, type Corner } from '../shared/wear-rate.ts';
import { TYRE_LIFE_BEHAVIOUR, type TyreLifeEffect } from './behaviour.ts';
import { TYRE_LIFE_CONFIG } from './config.ts';
import { AGE_LOSS_LIMIT_KEY, limitFallback, WEAR_LIMIT_KEY, wearRateKey } from './priors.ts';
import type { TyreLife, TyreLifeOutput } from './types.ts';

const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];

type Priors = AsOfView['priors'];
type CornerLife = TyreLife['corners']['fl'];
type Limits = { limitPct: number; ageLossLimitMs: Ms };

/** A set as a lap record or the live state shows it: its compound and its age in laps. */
export type FittedSet = { actualCompound: LapRecord['actualCompound']; visualCompound: VisualCompound; age: number };

/**
 * A car's tyres now, as the form reads them: the fitted set (`undefined`: a set no recorded lap ran on, whose age the
 * projection does not hold), the wear per corner and the game's life span of the set.
 */
export type TyresNow = {
  set: FittedSet | undefined;
  wearPct: Corners<DeepReadonly<Known<Percent>>>;
  gameLifeSpanLaps: Known<number>;
};

/**
 * The parts of the view `behaviourFor` (the open spans) and a config section's `read` (the config) look at. Both are
 * typed on the whole `EngineView` though they read only these: the as-of view has no live state.
 */
const readersOf = (view: AsOfView): EngineView => ({ situation: view.situation, config: view.config }) as Pick<EngineView, 'situation' | 'config'> as EngineView;

/** The known value of priors entry `key`, if the run's snapshot holds one. */
function priorValue(priors: Priors, key: string): number | undefined {
  if (!priors.known) return undefined;
  const entry = priors.value.entries[key];
  return entry?.known === true ? entry.value : undefined;
}

/**
 * The value of limit `key` in force: the set's override-only entry when the snapshot holds it, else the entry's declared
 * fallback (the config's), the one default the run and the calibration panel use (C43).
 */
function limitOf(view: AsOfView, key: typeof WEAR_LIMIT_KEY | typeof AGE_LOSS_LIMIT_KEY): number {
  return priorValue(view.priors, key) ?? limitFallback(key)({ config: view.config, track: view.track }).value.value;
}

/** The limits in force (the age limit in whole ms, C4). */
function limitsOf(view: AsOfView): Limits {
  return { limitPct: limitOf(view, WEAR_LIMIT_KEY), ageLossLimitMs: Math.round(limitOf(view, AGE_LOSS_LIMIT_KEY)) };
}

/**
 * The laps (oldest first) that ran on the fitted set: the newest of `laps` back to the first that was not on it. A lap on
 * another compound, or with more laps on its set than a newer lap of the run (or than the fitted set now), was on
 * another set. So a set fitted before its stint is recorded (a stop whose in lap is the newest lap, a garage visit)
 * has no samples from the set before it; nor has a set no recorded lap ran on.
 */
function onFittedSet(laps: readonly LapRecord[], set: FittedSet | undefined): LapRecord[] {
  if (set === undefined) return [];
  let age = set.age;
  let first = laps.length;
  while (first > 0) {
    const l = laps[first - 1] as LapRecord;
    if (l.actualCompound !== set.actualCompound || l.visualCompound !== set.visualCompound || l.tyreAgeAtStart > age) break;
    age = l.tyreAgeAtStart;
    first--;
  }
  return laps.slice(first);
}

/** Laps until `ν · age` reaches the loss limit, from `age` on: 0 at or past it; `insufficientData` without a positive `ν` or an age. */
function ageLaps(nu: DeepReadonly<Known<number>> | undefined, age: number | undefined, ageLossLimitMs: Ms): Known<number> {
  if (nu === undefined || !nu.known || nu.value <= 0 || age === undefined) return unknown('insufficientData');
  return known(Math.max(0, ageLossLimitMs / nu.value - age), nu.at);
}

/** The car's laps to the limit on the wear basis: its corner with the fewest known laps; `insufficientData` if none. */
function worstCorner(corners: Corners<CornerLife>): Known<number> {
  let worst: Known<number> = unknown('insufficientData');
  for (const c of CORNERS) {
    const laps = corners[c].lapsToLimit;
    if (laps.known && (!worst.known || laps.value < worst.value)) worst = laps;
  }
  return worst;
}

/**
 * The life of a fresh set of `compound`: from the priors' wear rates when all four corners are known, laps from 0 to the
 * limit at the worst corner; else from `ν` (the car's newest stint on the compound, else the priors'), the age at which
 * `ν · age` reaches the loss limit; else `insufficientData`.
 */
function freshLife(compound: VisualCompound, priors: Priors, stints: readonly DeepReadonly<StintDegradation>[], limits: Limits): Known<number> {
  const rates = CORNERS.map((c) => priorValue(priors, wearRateKey(compound, c)));
  const worstRate = rates.every((r) => r !== undefined) ? Math.max(0, ...rates) : 0;
  if (worstRate > 0) return known(limits.limitPct / worstRate, 0);
  const own = stints.findLast((s) => s.visual === compound)?.nuMsPerLap;
  const prior = priorValue(priors, priorKey('nuMsPerLap', compound));
  return ageLaps(own ?? (prior === undefined ? undefined : known(prior, 0)), 0, limits.ageLossLimitMs);
}

/**
 * Per car of `cars` in the session (its rows, `TYRE_LIFE_BEHAVIOUR`), with its tyres now (`tyresOf`): wear, its rate
 * (the median of the rate laps' own wear gains, over the current stint's laps on the fitted set) and the laps until the
 * wear limit (0 at or past it) per corner; the set's laps to its limit on its basis (each `insufficientData` before the
 * current stint has run `minLaps` laps); the fresh-set life per compound; the game's life span of the fitted set.
 */
export function tyreLifeOf(view: AsOfView, cars: readonly CarId[], tyresOf: (car: CarId) => TyresNow): TyreLifeOutput {
  const readers = readersOf(view);
  const limits = limitsOf(view);
  const { minLaps } = TYRE_LIFE_CONFIG.read(readers);
  const rateOpts = PER_LAP_RATE_CONFIG.read(readers);
  const classes = LAP_CLASSES_CONFIG.read(readers);
  const degradation = (view.outputs.get(DEGRADATION) as DeepReadonly<DegradationOutput> | undefined) ?? {};
  const out: Record<CarId, TyreLife> = {};
  for (const id of cars) {
    const effect: TyreLifeEffect = Object.assign({}, ...behaviourFor(TYRE_LIFE_BEHAVIOUR, readers, id));
    if (effect.inSession !== true) continue;
    const tyres = tyresOf(id);
    // the set's laps: the set change is looked for over every lap of the stint (an in lap included), and only then are
    // the rate laps taken (`wearRatePerCorner` picks them itself)
    const stintLaps = currentStintLaps(view.history, id);
    const own = onFittedSet(stintLaps, tyres.set);
    // the rates come from this stint: before it has run `minLaps` laps there are no laps to the limit (spec 7, K17)
    const measured = stintLaps.length >= minLaps;
    const rates = wearRatePerCorner(own, { lapClasses: classes, rate: rateOpts });
    const corner = (c: Corner): CornerLife => {
      const wearPct = tyres.wearPct[c] as Known<Percent>;
      if (!wearPct.known) return { wearPct, ratePctPerLap: wearPct, lapsToLimit: wearPct };
      const rate = rates[c];
      return {
        wearPct,
        ratePctPerLap: rate.known ? known(rate.value.perLap, rate.at) : rate,
        lapsToLimit: measured ? lapsToReach(rate, wearPct, limits.limitPct, 'rising') : unknown('insufficientData'),
      };
    };
    const corners = Object.fromEntries(CORNERS.map((c) => [c, corner(c)])) as Corners<CornerLife>;
    const stints = degradation[id] ?? [];
    // the basis follows the wear read: `wear` while every corner's wear is visible (the shared rule, `wearBasis`)
    const basis = wearBasis(tyres.wearPct as Corners<Known<Percent>>);
    out[id] = {
      corners,
      lapsToLimit: !measured
        ? unknown('insufficientData')
        : basis === 'wear'
          ? worstCorner(corners)
          : ageLaps(stints.at(-1)?.nuMsPerLap, tyres.set?.age, limits.ageLossLimitMs),
      basis,
      limitPct: limits.limitPct,
      ageLossLimitMs: limits.ageLossLimitMs,
      freshLifeLaps: Object.fromEntries(COMPOUNDS.map((c) => [c, freshLife(c, view.priors, stints, limits)])) as Record<VisualCompound, Known<number>>,
      gameLifeSpanLaps: tyres.gameLifeSpanLaps,
    };
  }
  return out;
}

const NO_LAP = unknown('notReceived');

/**
 * A car's tyres as of the projection: the set of its newest lap, aged one lap more than at that lap's start, unless the
 * car's newest stint record ends at a fitting after that lap (a set no recorded lap ran on); the wear at the
 * newest lap's end; no game life span (the live state's only).
 */
function tyresAsOf(view: AsOfView, car: CarId): TyresNow {
  const laps = currentLaps((view.history.laps as readonly LapRecord[]).filter((l) => l.carId === car));
  const newest = laps.at(-1);
  if (newest === undefined) return { set: undefined, wearPct: { fl: NO_LAP, fr: NO_LAP, rl: NO_LAP, rr: NO_LAP }, gameLifeSpanLaps: NO_LAP };
  const stint = view.history.stints.filter((s) => s.carId === car).at(-1);
  // a fitting closes the stint at its in lap (the newest lap, or the lap the car is on); the session's end closes it at
  // the newest lap, which is no in lap, and fits no set
  const refitted = stint !== undefined && (stint.lastLap > newest.lapNumber || (stint.lastLap === newest.lapNumber && newest.inLap));
  const set = refitted ? undefined : { actualCompound: newest.actualCompound, visualCompound: newest.visualCompound, age: newest.tyreAgeAtStart + 1 };
  return { set, wearPct: newest.wearAtEndPct, gameLifeSpanLaps: NO_LAP };
}

/** The cars with a car-status span open at the view's frame (C17): the cars of the session. */
const carsOf = (view: AsOfView): CarId[] => [...new Set((view.situation.byMachine['car-status'] ?? []).flatMap((s) => (s.carId === undefined ? [] : [s.carId])))];

/** `tyre-life`'s output as of the view's frame. */
export function tyreLifeAsOf(view: AsOfView): TyreLifeOutput {
  return tyreLifeOf(view, carsOf(view), (car) => tyresAsOf(view, car));
}
