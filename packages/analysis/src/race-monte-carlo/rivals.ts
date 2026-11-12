// The rivals of one scenario (SP4.3b spec §7.2, O8; ruling R23): each rival's stop drawn from its window
// (`rival-stops` through the starting point, F3), and its reaction to an SC: a rival with a stop still ahead and tyres
// at least `aMin` laps old boxes with chance `q` (one draw per SC, at its first lap it qualifies), never under a VSC.
// The one source of a rival's next compound and of whether a stop lies ahead (4.3b2 preconditions).
import { NOISE_COMPOUNDS, type NoiseCompound, type Scenario, type StartingPoint } from '@pitwall/domain';
import { streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { MC_PURPOSE } from './constants.ts';
import type { RivalRules } from './types.ts';

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
