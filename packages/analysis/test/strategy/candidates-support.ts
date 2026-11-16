// The hand-built field and the real DP solves of `strategy`'s candidate tests (SP4.3c Task 20, spec §5.4; C43):
// `candidates.test.ts` and `table-fields.test.ts` row 9 read them.
//
// How these tests read `candidatesOf` (the test agent's decisions, SP4.3c Task 20; supervisor ruling R59):
// - `candidatesOf(start, car, dp, solutions, config)`: `dp` is the car's `solveDp` result, `solutions[w]` world w's
//   `solveWorld` solve of the same input (a `DpPlan`'s `world` indexes it). The function queries the solutions with
//   `bestWith` and never solves.
// - Sources (R59, no domain change): base plans `'dp'`; stop-lap neighbours `'neighbour'`; the rule families `'rule'`
//   with `rule` `mirrorAhead`, `mirrorBehind`; the committed row is the job's (`'committed'`).
// - Base: per world and stop count (0–3) the best `dpPlansMax` plans by `expectedMs`, each a stop list (the
//   rain filter of Task 23a unchanged); `boxThisLap` and `continue` besides.
// - A neighbour: the best plan's first stop moved by `neighbourMinLaps`–`neighbourMaxLaps` laps either way on the
//   same compound, as `bestWith(solutions[best.world], { stopLap, compound })`: its stops; `null`
//   gives no candidate.
// - A mirror of the nearest rival ahead (behind) not of ours: its first stop is the first stop of `race-monte-carlo`'s
//   `rivalPlainPolicy` for that rival, lap **and compound**, as `bestWith(solutions[w], { stopLap, compound })` of a
//   world w; never `start.stopMid` alone.
//
// The field: 8 cars 2 s apart from lap 20 of 50, our cars 2 and 5; the rival ahead of car 2 (car 1) plainly stops on
// lap 33 for inters (`nextOdds`), the one behind (car 3) on lap 27 for softs. The track is wet (600 ms), so inter
// plans and candidates pass the Task 23a rain filter. The DP input: car 2 on mediums from its start lap, two dry
// worlds (identical), soft, medium, hard and inter sets, wear and degradation so a stop pays.
import { carId, type CarId, type StartingPoint } from '@pitwall/domain';
import type { McCandidate } from '../../src/race-monte-carlo/index.ts';
import { startLapOf } from '../../src/race-forecast/index.ts';
import { solveDp, solveWorld, type DpInput, type DpResult, type DpSolution } from '../../src/strategy-dp/index.ts';
import { candidatesOf as candidatesOfUnit, type CandidatesConfig } from '../../src/strategy/candidates.ts';
import { STRATEGY_CONFIG } from '../../src/strategy/config.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { dpInput, LAP as DP_LAP, type DpSpec } from '../strategy-dp/support.ts';

/**
 * `candidatesOf` with the signature these tests read (above): the world solves beside the DP result. Typed through this
 * alias while the unit's function still takes four arguments (SP4.3c Task 20's test phase), so the package typechecks.
 */
export type CandidatesOf = (start: StartingPoint, car: CarId, dp: DpResult, solutions: readonly DpSolution[], config: CandidatesConfig) => McCandidate[];
export const candidatesOf = candidatesOfUnit as unknown as CandidatesOf;

export const CAR: CarId = carId(2);
export const AHEAD: CarId = carId(1);
export const BEHIND: CarId = carId(3);
export const LAP = 20;
export const LAPS = 50;
export const AHEAD_STOP = { lap: 33, compound: 'inter' } as const;
export const BEHIND_STOP = { lap: 27, compound: 'soft' } as const;

/** The candidates' config: strategy's defaults and the one close gap (`race-interaction`'s `closeGapMs`, C43). */
export const CONFIG = { ...STRATEGY_CONFIG.defaults, closeGapMs: 2_500 };

/** The field above. */
export function field(): StartingPoint {
  const start = startingPoint({ lap: LAP, lapsTotal: LAPS, cars: Array.from({ length: 8 }, () => ({})), ours: [2, 5] });
  const plain = (k: CarId, low: number, mid: number, high: number, compound: 'inter' | 'soft'): void => {
    start.stopLow[k] = low;
    start.stopMid[k] = mid;
    start.stopHigh[k] = high;
    start.nextOdds[k] = { [compound]: 1 };
  };
  plain(AHEAD, 30, AHEAD_STOP.lap, 36, AHEAD_STOP.compound);
  plain(BEHIND, 25, BEHIND_STOP.lap, 30, BEHIND_STOP.compound);
  start.sets[CAR] = [...(start.sets[CAR] ?? []), ...Array.from({ length: 2 }, () => ({ compound: 'inter' as const, wearPct: 0 }))];
  return { ...start, wetness: { wetnessMs: 600, sdMs: 0, wet: true } };
}

/** Car 2's DP input on `start`: from its start lap to the flag, two worlds; `sets` its new sets (default soft, medium, hard and inter, 2 each). */
export function input(start: StartingPoint = field(), sets: DpSpec['sets'] = { soft: 2, medium: 2, hard: 2, inter: 2 }): DpInput {
  return dpInput({
    fromLap: startLapOf(start, CAR),
    totalLaps: LAPS,
    lap: { ...DP_LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: 600, wet: 900 }, convexMsPerPct2: 2 },
    car: { compound: 'medium', degMsPerLap: 60, tyreAge: 4, wearPct: 8 },
    sets,
    worlds: [{ u: 0.25 }, { u: 0.75 }],
  });
}

/** The real solves: `solveDp`'s result and one `solveWorld` per world, computed once per input. */
export type Solved = { input: DpInput; dp: DpResult; solutions: DpSolution[] };

const cache = new WeakMap<DpInput, Solved>();
export function solved(of: DpInput): Solved {
  let s = cache.get(of);
  if (s === undefined) {
    s = { input: of, dp: solveDp(of), solutions: of.worlds.map((_, w) => solveWorld(of, w)) };
    cache.set(of, s);
  }
  return s;
}
