// `tyre-life` (spec 4.2): per car in the session, the laps until its set reaches its limit, on the wear basis (per corner
// at its wear rate, the worst corner limiting) when the car's wear is visible, else on the age basis (`degradation`'s
// `ν`); and the fresh-set life per compound. The limits are the config's unless the run's calibration set overrides them.
import { known, unknown, type CarId, type CarState, type Corners, type Known, type LapRecord, type Ms, type TyreSet, type VisualCompound } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../degradation/index.ts';
import { priorKey } from '../degradation/priors.ts';
import { isRateLap, LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { lapsToReach, PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { currentStintLaps } from '../shared/stint-laps.ts';
import { TYRE_LIFE_BEHAVIOUR, type TyreLifeEffect } from './behaviour.ts';
import { TYRE_LIFE, TYRE_LIFE_CONFIG, type TyreLife, type TyreLifeOutput } from './index.ts';
import { AGE_LOSS_LIMIT_KEY, WEAR_LIMIT_KEY, wearRateKey } from './priors.ts';
import { CORNERS, wearBasis, wearRatePerCorner, type Corner } from '../shared/wear-rate.ts';

const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];

type Priors = EngineView['priors'];
type CornerLife = TyreLife['corners']['fl'];
type Limits = { limitPct: number; ageLossLimitMs: Ms };

/** The known value of priors entry `key`, if the run's snapshot holds one. */
function priorValue(priors: Priors, key: string): number | undefined {
  if (!priors.known) return undefined;
  const entry = priors.value.entries[key];
  return entry?.known === true ? entry.value : undefined;
}

/** The limits in force: the config's, each replaced by the set's override-only entry when the snapshot holds it. */
function limitsOf(priors: Priors, config: (typeof TYRE_LIFE_CONFIG)['defaults']): Limits {
  return {
    limitPct: priorValue(priors, WEAR_LIMIT_KEY) ?? config.wearLimitPct,
    ageLossLimitMs: Math.round(priorValue(priors, AGE_LOSS_LIMIT_KEY) ?? config.ageLossLimitMs),
  };
}

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

/** Laps until `ν · age` reaches the loss limit, from `age` on: 0 at or past it; `insufficientData` without a positive `ν`. */
function ageLaps(nu: DeepReadonly<Known<number>> | undefined, age: number, ageLossLimitMs: Ms): Known<number> {
  if (nu === undefined || !nu.known || nu.value <= 0) return unknown('insufficientData');
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
 * Per car in the session (its rows, `TYRE_LIFE_BEHAVIOUR`): wear now, its rate (the median of the rate laps' own wear
 * gains, over the current stint's laps on the fitted set) and the laps until the wear limit (0 at or past it) per corner;
 * the set's laps to its limit on its basis; the fresh-set life per compound; the game's life span of the fitted set.
 */
export const tyreLifeCalculator: QuickCalculator<TyreLifeOutput> = {
  id: TYRE_LIFE,
  kind: 'quick',
  reads: ['laps', 'stints', 'tyres', 'decisions', CAR_STATUS_READS, { calculator: 'degradation' }],
  cadence: { hz: 4 },
  compute: (view: EngineView): TyreLifeOutput => {
    const limits = limitsOf(view.priors, TYRE_LIFE_CONFIG.read(view));
    const rateOpts = PER_LAP_RATE_CONFIG.read(view);
    const classes = LAP_CLASSES_CONFIG.read(view);
    const degradation = (view.outputs.get(DEGRADATION) as DeepReadonly<DegradationOutput> | undefined) ?? {};
    const out: Record<CarId, TyreLife> = {};
    for (const car of view.live.cars) {
      const effect: TyreLifeEffect = Object.assign({}, ...behaviourFor(TYRE_LIFE_BEHAVIOUR, view, car.id));
      if (effect.inSession !== true) continue;
      // the set's rate laps: the fitted set is judged over the stint's rate laps (`isRateLap`, as before the shared rule)
      const own = onFittedSet(
        currentStintLaps(view.history, car.id).filter((l) => isRateLap(l, classes)),
        car.tyres,
      );
      const rates = wearRatePerCorner(own, { lapClasses: classes, rate: rateOpts });
      const corner = (c: Corner): CornerLife => {
        const wearPct = car.tyres.corners[c].wearPct;
        if (!wearPct.known) return { wearPct, ratePctPerLap: wearPct, lapsToLimit: wearPct };
        const rate = rates[c];
        return {
          wearPct,
          ratePctPerLap: rate.known ? known(rate.value.perLap, rate.at) : rate,
          lapsToLimit: lapsToReach(rate, wearPct, limits.limitPct, 'rising'),
        };
      };
      const corners = Object.fromEntries(CORNERS.map((c) => [c, corner(c)])) as Corners<CornerLife>;
      const stints = degradation[car.id] ?? [];
      // the basis follows the live state: `wear` while every corner's wear is visible (the shared rule, `wearBasis`)
      const basis = wearBasis({ fl: car.tyres.corners.fl.wearPct, fr: car.tyres.corners.fr.wearPct, rl: car.tyres.corners.rl.wearPct, rr: car.tyres.corners.rr.wearPct });
      out[car.id] = {
        corners,
        lapsToLimit: basis === 'wear' ? worstCorner(corners) : ageLaps(stints.at(-1)?.nuMsPerLap, car.tyres.age, limits.ageLossLimitMs),
        basis,
        limitPct: limits.limitPct,
        ageLossLimitMs: limits.ageLossLimitMs,
        freshLifeLaps: Object.fromEntries(COMPOUNDS.map((c) => [c, freshLife(c, view.priors, stints, limits)])) as Record<VisualCompound, Known<number>>,
        gameLifeSpanLaps: gameLifeSpan(car.tyres.sets),
      };
    }
    return out;
  },
};
