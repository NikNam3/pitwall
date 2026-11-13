// The rivals of one scenario (SP4.3b spec §7.2, O8; ruling R23): each rival's stop drawn from its window
// (`rival-stops` through the starting point, F3), and its reaction to an SC: a rival with a stop still ahead and tyres
// at least `aMin` laps old boxes with chance `q` (one draw per SC, at its first lap it qualifies), never under a VSC.
// The one source of a rival's next compound and of whether a stop lies ahead (4.3b2 preconditions).
import { NOISE_COMPOUNDS, type LapModelParams, type NoiseCompound, type Policy, type Scenario, type StartingPoint, type TyreType } from '@pitwall/domain';
import { streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { MC_PURPOSE } from './constants.ts';
import type { RivalRules } from './types.ts';
import type { WeatherLap } from './weather.ts';

/** Whether car slot `k` has a stop ahead before the flag: running and its window opening before the last lap (R23). */
export function hasStopAhead(start: StartingPoint, k: number): boolean {
  return start.retired[k] !== 1 && (start.stopLow[k] ?? start.lapsTotal) < start.lapsTotal;
}

const OTHER_DRY: Record<NoiseCompound, NoiseCompound> = { soft: 'medium', medium: 'hard', hard: 'medium', inter: 'medium', wet: 'medium' };

/**
 * The compound car slot `k` fits at its next stop; `null` without a stop ahead. A car owing the second dry compound
 * (the compound rule's judgement, `owesStop`, C43) fits a dry compound other than its own; else it keeps its own type.
 */
export function rivalNextCompound(start: StartingPoint, k: number): NoiseCompound | null {
  if (!hasStopAhead(start, k)) return null;
  const own = NOISE_COMPOUNDS[start.compound[k] ?? 1] ?? 'medium';
  return start.owesStop[k] === 1 ? OTHER_DRY[own] : own;
}

const TYPE_OF: Record<NoiseCompound, TyreType> = { soft: 'slick', medium: 'slick', hard: 'slick', inter: 'inter', wet: 'wet' };
/** The compound a rival fits for each type when it switches (a switch back to slicks: the medium, the field's usual one). */
const SWITCH_TO: readonly NoiseCompound[] = ['medium', 'inter', 'wet'];

/** A compound's lap time at wetness `w` against the others: its offset plus its type's wetness term (`lap-model`). */
const typeMs = (p: LapModelParams, compound: NoiseCompound, w: number): number => p.compoundOffsetMs[compound] + p.wetnessMsPerMs[TYPE_OF[compound]] * w;

/**
 * Car slot `k`'s stops in one scenario (spec §7.2, O8): its dry stop at the end of lap `dryLap` (-1: none), and its
 * switches of tyre type under the scenario's `weather`. At the first lap L whose wetness makes its type slower than
 * another type (offset and wetness term), it boxes at the end of lap L + `reactionLaps` for the fastest type at L, or at
 * the end of the first lap of L … L + `reactionLaps` an SC is out on; boxing for its dry stop meanwhile, it switches
 * there. A dry stop after a switch is not made (the switch fitted fresh tyres).
 */
export function rivalPlan(start: StartingPoint, k: number, dryLap: number, weather: readonly WeatherLap[] | null, neutralisations: Scenario['neutralisations'], reactionLaps: number): Policy {
  const dryCompound = rivalNextCompound(start, k);
  const dry = dryLap === -1 || dryCompound === null ? null : { lap: dryLap, compound: dryCompound };
  if (weather === null || start.retired[k] === 1) return { stops: dry === null ? [] : [dry], triggers: [] };
  const model = start.lapModel;
  const scOut = (lap: number): boolean => neutralisations.some((n) => n.kind === 'sc' && n.fromLap <= lap && lap <= n.toLap);
  const stops: Policy['stops'] = [];
  let current: NoiseCompound = NOISE_COMPOUNDS[start.compound[k] ?? 1] ?? 'medium';
  let switched = false;
  let pending: { lap: number; compound: NoiseCompound } | null = null;
  for (const w of weather) {
    const lap = w.lap;
    if (lap >= start.lapsTotal) break;
    if (pending === null) {
      let best: NoiseCompound | null = null;
      for (const c of SWITCH_TO) {
        if (TYPE_OF[c] === TYPE_OF[current]) continue;
        if (best === null || typeMs(model, c, w.wetnessMs) < typeMs(model, best, w.wetnessMs)) best = c;
      }
      if (best !== null && typeMs(model, best, w.wetnessMs) < typeMs(model, current, w.wetnessMs)) {
        let at = lap + reactionLaps;
        for (let l = lap; l <= lap + reactionLaps; l++) {
          if (scOut(l)) {
            at = l;
            break;
          }
        }
        pending = { lap: at, compound: best };
      }
    }
    const boxesDry = !switched && dry !== null && dry.lap === lap;
    if (pending !== null && (pending.lap === lap || boxesDry)) {
      stops.push({ lap, compound: pending.compound });
      current = pending.compound;
      pending = null;
      switched = true;
    } else if (boxesDry) {
      stops.push(dry);
      current = dry.compound;
    }
  }
  return { stops, triggers: [] };
}

/** The lap of a triangular draw over [low, high] with mode `mid`, from the uniform `u`. */
function triangular(low: number, mid: number, high: number, u: number): number {
  if (high <= low) return low;
  const c = Math.min(Math.max(mid, low), high);
  const span = high - low;
  const x = u < (c - low) / span ? low + Math.sqrt(u * span * (c - low)) : high - Math.sqrt((1 - u) * span * (high - c));
  return Math.round(x);
}

/**
 * Every rival's stop lap in this scenario (-1: none before the flag) into `laps`; our cars (`ours`) are left at -1.
 * `draws`: the scenario's streams (`MC_PURPOSE`).
 */
export function rivalStops(start: StartingPoint, ours: ReadonlySet<number>, scenario: Scenario, rules: RivalRules, draws: Draws, laps: Int16Array): void {
  for (let k = 0; k < start.cars; k++) {
    laps[k] = -1;
    if (ours.has(k) || !hasStopAhead(start, k)) continue;
    const key = streamKey(draws, k, 0);
    const low = Math.max(start.stopLow[k] ?? start.lapsTotal, start.lap);
    const lap = triangular(low, start.stopMid[k] ?? low, Math.max(start.stopHigh[k] ?? low, low), uniform(key, MC_PURPOSE.rivalLap, 0));
    let stop = lap < start.lapsTotal ? lap : -1;
    // under an SC: a stop still ahead and tyres at least aMin laps old, then one draw against q (never under a VSC)
    for (const n of scenario.neutralisations) {
      if (n.kind !== 'sc') continue;
      for (let l = Math.max(n.fromLap, start.lap); l <= n.toLap && l < start.lapsTotal; l++) {
        if (stop !== -1 && stop < l) break;
        if ((start.tyreAge[k] ?? 0) + (l - start.lap) < rules.aMin) continue;
        if (uniform(key, MC_PURPOSE.rivalSc, n.fromLap) < rules.q) stop = l;
        break;
      }
    }
    laps[k] = stop;
  }
}
