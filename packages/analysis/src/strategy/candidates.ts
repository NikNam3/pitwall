// `strategy`'s candidates (SP4.3b spec §8.1 step 1, S21): per car the DP's plans and its box-now and stay-out variants
// (source `dp`); the stop-lap neighbours of the best plan, one stop moved by `neighbourMinLaps`–`neighbourMaxLaps` laps
// either way (`neighbour`; the supervisor's ruling: the best plan's only, so the count stays inside the cap); the rule
// candidates on the best plan (`rule`): mirror the rival directly ahead and the one directly behind (the first stop at
// its likeliest stop lap, `stopMid`), cover the car behind and extend past the car ahead (a `rivalPits` trigger within
// `closeGapMs`, `race-interaction`'s, the one close gap, C43). Every policy is `policyOf(plan, extra)`; no policy twice.
//
// SP4.3b Task 23a (supervisor rulings, 2026-11-13): at most `dpPlansMax` DP plans, the best by `expectedMs` (box this
// lap and continue besides); inter and wet plans only where rain can come (the track's wetness at the DP best plan's
// rain threshold, or rain coming over the remaining laps by `rain-outlook`'s rule, SP4.3c O3a; no forecast counts as no
// rain); the best plan's sequence twice, with every trigger of its own and without degradation-off and rain. SP4.3c Task
// 19 (each plan its own triggers): every other DP plan carries its own neutralised triggers; a neighbour and a rule the
// best plan's (and a cover or extend rule its own `rivalPits`). Which plans of which weather world are candidates is
// Task 20's; until then every world's plans are ranked together.
import type { CarId, Policy, StartingPoint, Trigger } from '@pitwall/domain';
import type { McCandidate } from '../race-monte-carlo/index.ts';
import { startLapOf } from '../race-forecast/index.ts';
import { RAIN_OUTLOOK_CONFIG, rainComing } from '../rain-outlook/index.ts';
import { policyOf } from '../shared/strategy-input/index.ts';
import type { DpPlan, DpResult } from '../strategy-dp/index.ts';
import type { StrategyConfig } from './config.ts';

export { policyOf };

/**
 * The candidates' config: `strategy`'s, the cover and extend rules' gap (`race-interaction`'s `closeGapMs`, C43) and
 * the rain threshold, `rain-outlook`'s `rainPct` (its effective config, C47; its default where not handed over).
 */
export type CandidatesConfig = StrategyConfig & { closeGapMs: number; rainPct?: number };

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
 * Whether rain can come for inter and wet plans (Task 23a; SP4.3c O3a): the track's wetness at the DP's rain threshold
 * (without a rain threshold, `track-wetness`'s `wet`), or rain coming over the starting point's remaining laps by
 * `rain-outlook`'s rule and threshold (`rainComing`, `rainPct`); no forecast counts as no rain.
 */
function rainCanCome(start: StartingPoint, fromLap: number, thresholds: readonly Trigger[], rainPct: number): boolean {
  const rain = thresholds.find((t) => t.kind === 'rain');
  if (rain === undefined ? start.wetness.wet : start.wetness.wetnessMs >= rain.wetnessMs) return true;
  return start.weather.known && rainComing(start.weather.value.byLap, fromLap, start.lapsTotal, rainPct);
}

/** Car `car`'s candidates from its DP result (spec §8.1 step 1); the committed row is the job's. */
export function candidatesOf(start: StartingPoint, car: CarId, dp: DpResult, config: CandidatesConfig): McCandidate[] {
  const out: McCandidate[] = [];
  const seen = new Set<string>();
  const add = (policy: Policy, source: McCandidate['source'], rule: McCandidate['rule'] = null): void => {
    const key = JSON.stringify(policy);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ policy, source, rule });
  };
  const fromLap = startLapOf(start, car);
  const neutralisedOf = (p: Pick<DpPlan, 'triggers'>): Trigger[] => p.triggers.filter((t) => t.kind === 'neutralised');
  const ranked = [...dp.plans].sort((a, b) => a.expectedMs - b.expectedMs);
  // the rain threshold: the DP's best plan's own (SP4.3c Task 19)
  const top = ranked[0] ?? dp.continue;
  const allowed = rainCanCome(start, fromLap, top.triggers, config.rainPct ?? RAIN_OUTLOOK_CONFIG.defaults.rainPct) ? () => true : (p: Pick<DpPlan, 'stops'>) => !p.stops.some((s) => WET.has(s.compound));
  const plans = ranked.filter(allowed).slice(0, config.dpPlansMax);
  const best = plans[0] ?? dp.continue;
  // a neighbour's and a rule's triggers: the best plan's neutralised ones
  const thresholds = neutralisedOf(best);

  // the best plan's own sequence: with every trigger of its own, and without degradation-off and rain
  add(policyOf(best), 'dp');
  add(policyOf({ stops: best.stops, triggers: best.triggers.filter((t) => t.kind !== 'degradationOff' && t.kind !== 'rain') }), 'dp');
  // every other DP plan with its own neutralised triggers
  for (const plan of [...plans.slice(1), ...(dp.boxThisLap === null ? [] : [dp.boxThisLap]), dp.continue]) {
    if (plan !== best && allowed(plan)) add(policyOf({ stops: plan.stops, triggers: neutralisedOf(plan) }), 'dp');
  }

  for (let k = 0; k < best.stops.length; k++) {
    const lap = (best.stops[k] as Stops[number]).lap;
    for (let d = config.neighbourMinLaps; d <= config.neighbourMaxLaps; d++) {
      for (const moved of [lap - d, lap + d]) {
        const stops = moveStop(best.stops, k, moved, fromLap, start.lapsTotal);
        if (stops !== null) add(policyOf({ stops, triggers: thresholds }), 'neighbour');
      }
    }
  }

  if (best.stops.length > 0) {
    const ahead = rivalNext(start, car, -1);
    const behind = rivalNext(start, car, 1);
    const mirrors: [CarId | undefined, 'mirrorAhead' | 'mirrorBehind'][] = [[ahead, 'mirrorAhead'], [behind, 'mirrorBehind']];
    for (const [rival, rule] of mirrors) {
      if (rival === undefined) continue;
      const stops = moveStop(best.stops, 0, start.stopMid[rival] ?? start.lapsTotal, fromLap, start.lapsTotal);
      if (stops !== null) add(policyOf({ stops, triggers: thresholds }, []), 'rule', rule);
    }
    const rivalPits = (carId: CarId, action: 'cover' | 'extend'): Trigger => ({ kind: 'rivalPits', carId, withinMs: config.closeGapMs, action });
    const ruled = { stops: best.stops, triggers: thresholds };
    if (behind !== undefined) add(policyOf(ruled, [rivalPits(behind, 'cover')]), 'rule', 'cover');
    if (ahead !== undefined) add(policyOf(ruled, [rivalPits(ahead, 'extend')]), 'rule', 'extend');
  }
  return out;
}
