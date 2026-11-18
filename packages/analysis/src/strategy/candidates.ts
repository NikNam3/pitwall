// `strategy`'s candidates from named sources (SP4.3c Task 20, spec §5.4, supervisor rulings R59, R60; C43; SP4.3d spec
// §5.1: every candidate a stop list): per car
// - base (`dp`): per weather world and stop count the best `dpPlansMax` DP plans by `expectedMs` (the bound applies
//   within a stop count, never across), box this lap and continue besides;
// - neighbours (`neighbour`): the best plan's first stop moved by `neighbourMinLaps`–`neighbourMaxLaps` laps either way
//   on its compound, `strategy-dp`'s `bestWith` on the best plan's world;
// - rules (`rule`): mirror the nearest rival ahead and behind not of ours (the first stop on the lap and compound of
//   `race-monte-carlo`'s one rival policy, `rivalPlainPolicy`, as a `bestWith` query of the first world that gives
//   one).
// A `bestWith` query that gives `null` gives no candidate. Inter and wet plans (stops or a free start's start
// compound) only where rain can come, by the one wet rule (`shared/wet-allowed.ts`; SP4.3e Task 4), on every
// candidate, the best plan, box this lap and continue included. The best plan is `bestPlanOf`'s, its one owner (C43). Every policy is `policyOf(plan)`; no policy twice. The committed row is the job's.
import type { CarId, Policy, StartingPoint } from '@pitwall/domain';
import { rivalPlainPolicy, type McCandidate } from '../race-monte-carlo/index.ts';
import { RAIN_OUTLOOK_CONFIG } from '../rain-outlook/index.ts';
import { policyOf } from '../shared/strategy-input/index.ts';
import { allowedPolicy } from '../shared/wet-allowed.ts';
import { bestWith, type DpPlan, type DpResult, type DpSolution } from '../strategy-dp/index.ts';
import type { StrategyConfig } from './config.ts';

export { policyOf };

/** The candidates' config: `strategy`'s and the rain threshold, `rain-outlook`'s `rainPct` (its effective config, C47; its default where not handed over). */
export type CandidatesConfig = StrategyConfig & { rainPct?: number };

type Stop = DpPlan['stops'][number];

/** The nearest running car that is not one of ours `step` places from `car` in the order (−1 ahead, +1 behind). */
function rivalNext(start: StartingPoint, car: CarId, step: -1 | 1): CarId | undefined {
  const ours = new Set(Object.keys(start.sets).map(Number));
  ours.add(car);
  const order = Array.from(start.order);
  for (let i = order.indexOf(car) + step; i >= 0 && i < order.length; i += step) {
    const k = order[i] as number;
    if (start.retired[k] === 1 || ours.has(k)) continue;
    return k as CarId;
  }
  return undefined;
}

/** Car `car`'s plan filter: the one wet rule (`shared/wet-allowed.ts`, C43) at the candidates' rain threshold. */
const allowedOf = (start: StartingPoint, car: CarId, config: CandidatesConfig): ((p: Pick<DpPlan, 'stops' | 'startCompound'>) => boolean) =>
  allowedPolicy(start, car, config.rainPct ?? RAIN_OUTLOOK_CONFIG.defaults.rainPct);

/**
 * Car `car`'s best plan, the one owner of it (C43): the least `expectedMs` of its DP plans the rain filter allows, else
 * continue, else box this lap, where allowed; `undefined` when the filter allows none (the job then plans the car not,
 * `unknown('insufficientData')`, C3). The candidates' first and the start compound of the job's reaction table (R31).
 */
export function bestPlanOf(start: StartingPoint, car: CarId, dp: DpResult, config: CandidatesConfig): DpPlan | undefined {
  const allowed = allowedOf(start, car, config);
  const fallback = [dp.continue, ...(dp.boxThisLap === null ? [] : [dp.boxThisLap])];
  return [...dp.plans].sort((a, b) => a.expectedMs - b.expectedMs).find(allowed) ?? fallback.find(allowed);
}

/** `plans` per world and stop count, each group's best `max` by `expectedMs` (the bound within a stop count, B5). */
function perStopCount(plans: readonly DpPlan[], max: number): DpPlan[] {
  const groups = new Map<string, DpPlan[]>();
  for (const p of plans) {
    const key = `${p.world}:${p.stops.length}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].flatMap((g) => g.sort((a, b) => a.expectedMs - b.expectedMs).slice(0, max));
}

/**
 * Car `car`'s candidates from its DP result and its solves (`solveAll`'s: per weather world, on a free start per start
 * compound and world; a plan's `world` and `startCompound` name its solve; queried with `bestWith` on the best plan's
 * start, never solved again; spec §5.4, SP4.3d spec §7.2); the committed row is the job's.
 */
export function candidatesOf(start: StartingPoint, car: CarId, dp: DpResult, solutions: readonly DpSolution[], config: CandidatesConfig): McCandidate[] {
  const out: McCandidate[] = [];
  const seen = new Set<string>();
  const add = (policy: Policy, source: McCandidate['source'], rule: McCandidate['rule'] = null): void => {
    const key = JSON.stringify(policy);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ policy, source, rule });
  };
  const allowed = allowedOf(start, car, config);
  const best = bestPlanOf(start, car, dp, config);
  // no plan the rain filter allows: no candidate (the job plans the car not)
  if (best === undefined) return out;

  // base: the best plan first, then every other base plan of each world and stop count, box this lap and continue
  if (allowed(best)) add(policyOf(best), 'dp');
  for (const plan of [...perStopCount(dp.plans.filter(allowed), config.dpPlansMax), ...(dp.boxThisLap === null ? [] : [dp.boxThisLap]), dp.continue]) {
    if (plan !== best && allowed(plan)) add(policyOf(plan), 'dp');
  }

  // the best plan's start: a free start's solves are per start compound and world (`solveAll`), queried on its start
  const bestStart = best.startCompound ?? null;
  const solveOf = (w: number): DpSolution | undefined => solutions.find((s) => s.world === w && s.start === bestStart);
  const worlds = [...new Set(solutions.map((s) => s.world))].sort((a, b) => a - b);

  /** `bestWith`'s plan of world `w` (on the best plan's start) whose first stop is `stop`, where it is one and allowed. */
  const query = (w: number, stop: Stop): DpPlan | null => {
    const s = solveOf(w);
    const q = s === undefined ? null : bestWith(s, { stopLap: stop.lap, compound: stop.compound });
    return q !== null && allowed(q) ? q : null;
  };

  // neighbours: the best plan's first stop moved, on its compound, in its world
  const first = best.stops[0];
  if (first !== undefined) {
    for (let d = config.neighbourMinLaps; d <= config.neighbourMaxLaps; d++) {
      for (const lap of [first.lap - d, first.lap + d]) {
        const q = query(best.world, { lap, compound: first.compound });
        if (q !== null) add(policyOf(q), 'neighbour');
      }
    }
  }

  // mirrors: the rival's plain first stop, lap and compound, in the first world that gives a plan
  const mirrors: [CarId | undefined, 'mirrorAhead' | 'mirrorBehind'][] = [[rivalNext(start, car, -1), 'mirrorAhead'], [rivalNext(start, car, 1), 'mirrorBehind']];
  for (const [rival, rule] of mirrors) {
    const stop = rival === undefined ? undefined : rivalPlainPolicy(start, rival, null).stops[0];
    if (stop === undefined) continue;
    for (const w of worlds) {
      const q = query(w, stop);
      if (q === null) continue;
      add(policyOf(q), 'rule', rule);
      break;
    }
  }
  return out;
}
