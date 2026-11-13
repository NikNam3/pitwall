// `strategy`'s candidates (SP4.3b spec §8.1 step 1, S21): per car the DP's plans and its box-now and stay-out variants
// (source `dp`); the stop-lap neighbours of the best plan, one stop moved by `neighbourMinLaps`–`neighbourMaxLaps` laps
// either way (`neighbour`; the supervisor's ruling: the best plan's only, so the count stays inside the cap); the rule
// candidates on the best plan (`rule`): mirror the rival directly ahead and the one directly behind (the first stop at
// its likeliest stop lap, `stopMid`), cover the car behind and extend past the car ahead (a `rivalPits` trigger within
// `ruleGapMs`). Every policy is `policyOf(plan, thresholds)`; no policy twice.
//
// SP4.3b Task 23a (supervisor rulings, 2026-11-13): at most `dpPlansMax` DP plans, the best by `expectedMs` (box-now and
// stay-out besides); inter and wet plans only where rain can come (the track's wetness at the DP's rain threshold, or
// the forecast's highest rain chance over the remaining laps at `rainCandidatePct`; no forecast counts as no rain); the
// best plan's sequence twice, with every DP threshold and without degradation-off and rain; every other candidate
// carries only the neutralised triggers (and a cover or extend rule its own `rivalPits`).
import type { CarId, Policy, StartingPoint, Trigger } from '@pitwall/domain';
import type { McCandidate } from '../race-monte-carlo/index.ts';
import { startLapOf } from '../race-forecast/index.ts';
import type { DpPlan, DpResult } from '../strategy-dp/index.ts';
import type { StrategyConfig } from './config.ts';

/** A plan's stops with the triggers that change them inside a scenario: the one builder of a candidate's policy. */
export function policyOf(plan: Pick<DpPlan, 'stops'> & Partial<DpPlan>, thresholds: readonly Trigger[]): Policy {
  return { stops: plan.stops.map((s) => ({ lap: s.lap, compound: s.compound })), triggers: thresholds.map((t) => structuredClone(t)) };
}

type Stops = DpPlan['stops'];

/** `stops` with stop `k` on `lap`, or `null` where it leaves the race (`fromLap` … `lapsTotal − 1`) or the stops' order. */
function moveStop(stops: Stops, k: number, lap: number, fromLap: number, lapsTotal: number): Stops | null {
  if (lap < fromLap || lap >= lapsTotal) return null;
  const before = stops[k - 1];
  const after = stops[k + 1];
  if ((before !== undefined && lap <= before.lap) || (after !== undefined && lap >= after.lap)) return null;
  return stops.map((s, i) => (i === k ? { ...s, lap } : { ...s }));
}

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

const WET: ReadonlySet<string> = new Set(['inter', 'wet']);

/**
 * Whether rain can come for inter and wet plans (Task 23a): the track's wetness at the DP's rain threshold (without a
 * rain threshold, any wetness), or the forecast's highest rain chance from `fromLap` to the flag at `rainCandidatePct`.
 */
function rainCanCome(start: StartingPoint, fromLap: number, thresholds: readonly Trigger[], config: StrategyConfig): boolean {
  const rain = thresholds.find((t) => t.kind === 'rain');
  const wetness = start.wetness.wetnessMs;
  if (rain === undefined ? wetness > 0 : wetness >= rain.wetnessMs) return true;
  if (!start.weather.known) return false;
  return start.weather.value.byLap.some((l) => l.lap >= fromLap && l.lap <= start.lapsTotal && l.rainPct >= config.rainCandidatePct);
}

/** Car `car`'s candidates from its DP result (spec §8.1 step 1); the committed row is the job's. */
export function candidatesOf(start: StartingPoint, car: CarId, dp: DpResult, config: StrategyConfig): McCandidate[] {
  const out: McCandidate[] = [];
  const seen = new Set<string>();
  const add = (policy: Policy, source: McCandidate['source']): void => {
    const key = JSON.stringify(policy);
    if (seen.has(key)) return;
    seen.add(key);
    // the rule is named from SP4.3b2 Task 6; until then `null` on every candidate
    out.push({ policy, source, rule: null });
  };
  const fromLap = startLapOf(start, car);
  const thresholds = dp.thresholds.filter((t) => t.kind === 'neutralised');
  const allowed = rainCanCome(start, fromLap, dp.thresholds, config) ? () => true : (p: Pick<DpPlan, 'stops'>) => !p.stops.some((s) => WET.has(s.compound));
  const plans = dp.plans
    .filter(allowed)
    .sort((a, b) => a.expectedMs - b.expectedMs)
    .slice(0, config.dpPlansMax);
  const best = plans[0] ?? dp.stayOut;

  // the best plan's own sequence: with every DP threshold, and without degradation-off and rain
  add(policyOf(best, dp.thresholds), 'dp');
  add(policyOf(best, dp.thresholds.filter((t) => t.kind !== 'degradationOff' && t.kind !== 'rain')), 'dp');
  for (const plan of [...plans.slice(1), ...(dp.boxNow === null ? [] : [dp.boxNow]), dp.stayOut]) {
    if (plan !== best && allowed(plan)) add(policyOf(plan, thresholds), 'dp');
  }

  for (let k = 0; k < best.stops.length; k++) {
    const lap = (best.stops[k] as Stops[number]).lap;
    for (let d = config.neighbourMinLaps; d <= config.neighbourMaxLaps; d++) {
      for (const moved of [lap - d, lap + d]) {
        const stops = moveStop(best.stops, k, moved, fromLap, start.lapsTotal);
        if (stops !== null) add(policyOf({ stops }, thresholds), 'neighbour');
      }
    }
  }

  if (best.stops.length > 0) {
    const ahead = rivalNext(start, car, -1);
    const behind = rivalNext(start, car, 1);
    for (const rival of [ahead, behind]) {
      if (rival === undefined) continue;
      const stops = moveStop(best.stops, 0, start.stopMid[rival] ?? start.lapsTotal, fromLap, start.lapsTotal);
      if (stops !== null) add(policyOf({ stops }, thresholds), 'rule');
    }
    const rivalPits = (carId: CarId, action: 'cover' | 'extend'): Trigger => ({ kind: 'rivalPits', carId, withinMs: config.ruleGapMs, action });
    if (behind !== undefined) add(policyOf(best, [...thresholds, rivalPits(behind, 'cover')]), 'rule');
    if (ahead !== undefined) add(policyOf(best, [...thresholds, rivalPits(ahead, 'extend')]), 'rule');
  }
  return out;
}
