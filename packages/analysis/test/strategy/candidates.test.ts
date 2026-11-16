// `strategy`'s candidates (SP4.3b spec §8.1 step 1, S21; plan 4.3b1 Task 20 row 1; 4.3b2 precondition 3): per car the
// DP's plans and its box-this-lap and continue variants, their stop-lap neighbours ±1–3 laps, and the rule candidates
// mirror ahead, mirror behind, cover and extend on the best plan; every policy built by one function, `policyOf(plan,
// extra)`: the plan's stops and its own triggers, then `extra`. A hand-built field (race-forecast's test builder) and a
// hand-made DP result, so every expected candidate is known (how they are read: `./support.ts`).
//
// Ported in SP4.3c Task 19 (the DP result's shape, spec §5.4: no shared thresholds, every plan its own triggers and
// world): a DP plan's candidate carries the plan's own triggers (the best plan's sequence also without degradation-off
// and rain); a candidate derived from the best plan (neighbour, rule) carries the best plan's neutralised triggers.
// Which candidates exist is Task 20's; this port keeps today's selection.
import { carId, known, type CarId, type McSource, type Policy, type StartingPoint, type Trigger, type TyreSet } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { candidatesOf, policyOf } from '../../src/strategy/candidates.ts';
import { STRATEGY_CONFIG } from '../../src/strategy/config.ts';
import { RACE_INTERACTION_CONFIG } from '../../src/race-interaction/config.ts';
import type { DpPlan, DpResult } from '../../src/strategy-dp/index.ts';
import { createRng } from '@pitwall/engine/readers';
import { candidatesForRun } from '../../src/strategy/job.ts';
import { prepareStrategy } from '../../src/strategy/index.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { json, PLAYER, RACE, SETS, TEAMMATE, TEST_CAP, viewAt } from './support.ts';

const CAR: CarId = carId(2);
const AHEAD: CarId = carId(1);
const BEHIND: CarId = carId(3);
const LAP = 5;
const LAPS = 30;

/** Eight cars 2 s apart, our cars 2 and 5; the rival ahead of car 2 likeliest to stop on lap 12, the one behind on 22. */
function field(): StartingPoint {
  const start = startingPoint({ lap: LAP, lapsTotal: LAPS, cars: Array.from({ length: 8 }, () => ({})), ours: [2, 5] });
  const window = (k: number, low: number, mid: number, high: number) => {
    start.stopLow[k] = low;
    start.stopMid[k] = mid;
    start.stopHigh[k] = high;
  };
  window(AHEAD, 10, 12, 14);
  window(BEHIND, 19, 22, 25);
  return start;
}

/** The best plan's own neutralised triggers. */
const NEUTRALISED: Trigger[] = [
  { kind: 'neutralised', condition: 'sc', fromLap: 6, toLap: 15, action: { box: 'hard' } },
  { kind: 'neutralised', condition: 'vsc', fromLap: 9, toLap: 14, action: { box: 'hard' } },
];
/** The two-stop's own: different from the best plan's, so a copy would show. */
const TWO_STOP_NEUTRALISED: Trigger[] = [{ kind: 'neutralised', condition: 'sc', fromLap: 6, toLap: 9, action: { box: 'hard' } }];

const plan = (stops: DpPlan['stops'], expectedMs: number, triggers: Trigger[] = [], world = 0): DpPlan => ({ stops, expectedMs, triggers, world });

/** The DP's result for car 2: the best one-stop on lap 16, a two-stop, box this lap and continue (its stop on lap 26). */
const BEST = plan([{ lap: 16, compound: 'hard' }], 1_000, NEUTRALISED);
const TWO_STOP = plan([{ lap: 10, compound: 'hard' }, { lap: 21, compound: 'medium' }], 2_000, TWO_STOP_NEUTRALISED);
const BOX_NOW = plan([{ lap: LAP, compound: 'hard' }], 3_000);
const STAY_OUT = plan([{ lap: 26, compound: 'hard' }], 4_000, [{ kind: 'neutralised', condition: 'sc', fromLap: 20, toLap: 25, action: { box: 'hard' } }]);
const DP: DpResult = {
  plans: [BEST, TWO_STOP],
  boxThisLap: BOX_NOW,
  continue: STAY_OUT,
  table: { boxUnderMs: new Float64Array(LAPS - LAP + 1), stayMs: new Float64Array(LAPS - LAP + 1) },
};

/** `p`'s stops with only its neutralised triggers. */
const neutralOnly = (p: DpPlan, from: DpPlan = p): Pick<DpPlan, 'stops' | 'triggers'> => ({ stops: p.stops, triggers: from.triggers.filter((t) => t.kind === 'neutralised') });

// the rule candidates' gap: the one close gap, `race-interaction`'s `closeGapMs` (SP4.3c Task 3), beside strategy's config
const CONFIG = { ...STRATEGY_CONFIG.defaults, closeGapMs: 2_500 };

/** The candidate of `policy`; fails the test when there is none or more than one. */
function find(cands: readonly { policy: Policy; source: McSource }[], policy: Policy): { policy: Policy; source: McSource } {
  const found = cands.filter((c) => json(c.policy) === json(policy));
  expect(found, `candidates with ${json(policy)}`).toHaveLength(1);
  return found[0]!;
}

const moved = (p: DpPlan, k: number, lap: number): DpPlan => ({ ...p, stops: p.stops.map((s, i) => (i === k ? { ...s, lap } : s)) });

describe('strategy: candidates', () => {
  // row 1
  it('candidates per car: DP plans, boxThisLap, continue, neighbours ±1–3, mirror ahead, mirror behind, cover, extend; each plan with its own triggers', () => {
    const start = field();
    const cands = candidatesOf(start, CAR, DP, CONFIG);
    // the DP's plans and its variants, each with its own (neutralised) triggers
    expect(find(cands, policyOf(BEST)).source).toBe('dp');
    for (const p of [TWO_STOP, BOX_NOW, STAY_OUT]) expect(find(cands, policyOf(neutralOnly(p))).source, json(p.stops)).toBe('dp');
    // the best plan's stop-lap neighbours, 1 to 3 laps either way, with the best plan's neutralised triggers
    for (const d of [-3, -2, -1, 1, 2, 3]) expect(find(cands, policyOf(neutralOnly(moved(BEST, 0, 16 + d)))).source, `lap ${16 + d}`).toBe('neighbour');
    // every neighbour is one stop of a DP plan or variant moved by 1 to 3 laps, the rest kept
    const bases = [BEST, TWO_STOP, BOX_NOW, STAY_OUT];
    for (const c of cands.filter((x) => x.source === 'neighbour')) {
      const isNeighbour = bases.some((b) =>
        b.stops.some((s, k) =>
          [-3, -2, -1, 1, 2, 3].some((d) => s.lap + d >= LAP && s.lap + d < LAPS && json(c.policy.stops) === json(moved(b, k, s.lap + d).stops)),
        ),
      );
      expect(isNeighbour, json(c.policy.stops)).toBe(true);
    }
    // the rules on the best plan: mirror the rival ahead and the one behind at their likeliest stop laps
    expect(find(cands, policyOf(neutralOnly(moved(BEST, 0, 12)))).source).toBe('rule');
    expect(find(cands, policyOf(neutralOnly(moved(BEST, 0, 22)))).source).toBe('rule');
    // cover the car behind and extend past the car ahead, within closeGapMs (from the config)
    const cover: Trigger = { kind: 'rivalPits', carId: BEHIND, withinMs: 2_500, action: 'cover' };
    const extend: Trigger = { kind: 'rivalPits', carId: AHEAD, withinMs: 2_500, action: 'extend' };
    expect(find(cands, policyOf(neutralOnly(BEST), [cover])).source).toBe('rule');
    expect(find(cands, policyOf(neutralOnly(BEST), [extend])).source).toBe('rule');
    // nothing else: no committed row (the job adds it), no policy twice
    expect(new Set(cands.map((c) => c.source))).toEqual(new Set(['dp', 'neighbour', 'rule']));
    expect(new Set(cands.map((c) => json(c.policy))).size).toBe(cands.length);
  });

  // 4.3b2 precondition 3, ported (SP4.3c Task 19): no candidate carries another plan's triggers
  it("every candidate's policy is policyOf(its plan, extra): a DP plan's own triggers; a neighbour's and a rule's the best plan's", () => {
    const cands = candidatesOf(field(), CAR, DP, CONFIG);
    expect(cands.length).toBeGreaterThan(0);
    const dpPlans = [BEST, TWO_STOP, BOX_NOW, STAY_OUT];
    for (const c of cands) {
      const own = c.policy.triggers.filter((t) => t.kind === 'rivalPits');
      const rest = c.policy.triggers.filter((t) => t.kind !== 'rivalPits');
      if (c.source === 'dp') {
        const p = dpPlans.find((x) => json(x.stops) === json(c.policy.stops))!;
        expect(p, json(c.policy.stops)).toBeDefined();
        // the plan's own triggers: all of them (the best plan's first candidate) or its neutralised ones
        expect([json(p.triggers), json(neutralOnly(p).triggers)], json(c.policy.stops)).toContain(json(rest));
      } else expect(rest, `${c.source} ${json(c.policy.stops)}`).toEqual(NEUTRALISED);
      expect(c.policy, json(c.policy.stops)).toEqual(policyOf({ stops: c.policy.stops, triggers: rest }, own));
    }
    // policyOf keeps the plan's stops and carries its own triggers, then the extra ones
    const p = policyOf(TWO_STOP);
    expect(p.stops).toEqual(TWO_STOP.stops);
    expect(p.triggers).toEqual(TWO_STOP_NEUTRALISED);
    const cover: Trigger = { kind: 'rivalPits', carId: BEHIND, withinMs: 2_500, action: 'cover' };
    expect(policyOf(TWO_STOP, [cover]).triggers).toEqual([...TWO_STOP_NEUTRALISED, cover]);
  });
});

// SP4.3b Task 23a (the end-of-run strategy defects; supervisor rulings 2026-11-13): at most `dpPlansMax` DP plans, the
// best by `expectedMs`; inter and wet plans only where rain can come; degradation-off and rain triggers only on the
// best plan's own sequence, as two candidates.
//
// How these rows read the rulings (the test agent's decisions, Task 23a report; ported in SP4.3c Task 19):
// - "The rain threshold" is the `rain` trigger's `wetnessMs` of the DP's best plan (its own triggers). The dry case keeps
//   the forecast's highest rainPct (4) and the current wetness (500 ms) below a threshold of 9,000 ms (more than one
//   rain lap's rise); the rain cases set a threshold of 50 ms and either a forecast of 100 % from lap 10 or a current
//   wetness of 600 ms, so each holds under any reading of "reaches".
// - "With the trigger" carries the best plan's degradation-off and rain triggers and its neutralised ones; "without"
//   carries neither of the two but its neutralised ones. Every other candidate carries only neutralised triggers (its
//   own plan's, or the best plan's for a neighbour or rule; plus a cover or extend rule's own `rivalPits`).
const isWetStop = (s: { compound: string }): boolean => s.compound === 'inter' || s.compound === 'wet';

const RAIN_THRESHOLD = (wetnessMs: number): Trigger => ({ kind: 'rain', wetnessMs, action: { box: 'inter' } });
const DEG_OFF: Trigger = { kind: 'degradationOff', wearRateDeltaPct: 0.3, action: { switchTo: [{ lap: 10, compound: 'hard' }, { lap: 20, compound: 'medium' }] } };
const DAMAGE: Trigger = { kind: 'damage', lossMsPerLap: 900, action: { box: 'hard' } };

/** The field with inter and wet sets for car 2, the forecast's rain chance per lap from `rainPct(lap)`, and the current wetness. */
function weatherField(rainPct: (lap: number) => number, wetnessMs: number): StartingPoint {
  const start = field();
  start.sets[CAR] = [...(start.sets[CAR] ?? []), ...Array.from({ length: 4 }, () => ({ compound: 'inter' as const, wearPct: 0 })), ...Array.from({ length: 3 }, () => ({ compound: 'wet' as const, wearPct: 0 }))];
  const byLap = Array.from({ length: LAPS - LAP + 1 }, (_, i) => ({ lap: LAP + i, rainPct: rainPct(LAP + i) }));
  return { ...start, weather: known({ byLap, accuracy: 'perfect' as const }, 0), wetness: { wetnessMs, sdMs: 0, wet: wetnessMs > 0 } };
}

/** A DP result with the dry plans above and three inter/wet plans (second best: a shower hedge), the best plan's `rain` at `threshold`. */
function wetDp(threshold: number): DpResult {
  const interThenMedium = plan([{ lap: 11, compound: 'inter' }, { lap: 13, compound: 'medium' }], 1_500);
  const inter = plan([{ lap: 12, compound: 'inter' }], 2_500);
  const wet = plan([{ lap: 14, compound: 'wet' }], 3_500);
  return { ...DP, plans: [{ ...BEST, triggers: [...NEUTRALISED, RAIN_THRESHOLD(threshold)] }, interThenMedium, TWO_STOP, inter, wet] };
}
const WET_PLANS = (dp: DpResult): DpPlan[] => dp.plans.filter((p) => p.stops.some(isWetStop));

describe('strategy: candidates (Task 23a)', () => {
  // row 1
  it('candidatesOf keeps at most dpPlansMax DP plans (config, 8), the best by expectedMs, plus boxThisLap and continue', () => {
    expect((STRATEGY_CONFIG.defaults as Record<string, unknown>).dpPlansMax, 'the default').toBe(8);
    // twelve dry two-stops, not in expectedMs order (the best first, as the DP gives it); none is a neighbour or rule of BEST
    const twoStop = (i: number, expectedMs: number): DpPlan => plan([{ lap: 7 + i, compound: 'medium' }, { lap: 24, compound: i % 2 === 0 ? 'hard' : 'soft' }], expectedMs);
    const ms = [5_000, 9_000, 6_000, 12_000, 7_000, 11_000, 8_000, 10_000, 6_500, 13_000, 7_500, 14_000];
    const plans = [BEST, ...ms.map((m, i) => twoStop(i, m))];
    const dp: DpResult = { ...DP, plans };
    for (const max of [8, 3]) {
      // `dpPlansMax` is the implementation's new config key (Task 23a): set through a widened object until it exists
      const config: typeof CONFIG = Object.assign({ ...CONFIG }, { dpPlansMax: max });
      const cands = candidatesOf(field(), CAR, dp, config);
      const byExpected = [...plans].sort((a, b) => a.expectedMs - b.expectedMs);
      const kept = byExpected.slice(0, max);
      const dropped = byExpected.slice(max);
      const dpStops = new Set(cands.filter((c) => c.source === 'dp').map((c) => json(c.policy.stops)));
      expect(dpStops, `dpPlansMax ${max}: the best ${max} plans, boxThisLap and continue`).toEqual(new Set([...kept, BOX_NOW, STAY_OUT].map((p) => json(p.stops))));
      for (const p of dropped) expect(cands.some((c) => json(c.policy.stops) === json(p.stops)), `dpPlansMax ${max}: dropped ${json(p.stops)}`).toBe(false);
    }
  });

  // row 2
  it('in a dry race (the forecast\'s highest rainPct and the current wetness below the rain threshold) no candidate has an inter or wet stop', () => {
    const dp = wetDp(9_000);
    const cands = candidatesOf(weatherField(() => 4, 500), CAR, dp, CONFIG);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(c.policy.stops.some(isWetStop), `${c.source}: ${json(c.policy.stops)}`).toBe(false);
    // the dry plans stay
    for (const p of [BEST, TWO_STOP]) expect(cands.some((c) => c.source === 'dp' && json(c.policy.stops) === json(p.stops)), json(p.stops)).toBe(true);
  });

  // row 3
  it('with rain forecast to reach the threshold, inter/wet plans are candidates', () => {
    const dp = wetDp(50);
    for (const [what, start] of [
      ['rain forecast from lap 10', weatherField((lap) => (lap >= 10 ? 100 : 0), 0)],
      ['the track already wet', weatherField(() => 0, 600)],
    ] as const) {
      const cands = candidatesOf(start, CAR, dp, CONFIG);
      for (const p of WET_PLANS(dp)) {
        expect(cands.some((c) => c.source === 'dp' && json(c.policy.stops) === json(p.stops)), `${what}: ${json(p.stops)}`).toBe(true);
      }
    }
  });

  // row 4
  it('degradationOff and rain triggers are attached only to the best plan\'s sequence, as two candidates (with and without the trigger); every other candidate carries only neutralised triggers', () => {
    const best: DpPlan = { ...BEST, triggers: [...NEUTRALISED, DAMAGE, DEG_OFF, RAIN_THRESHOLD(9_000)] };
    const dp: DpResult = { ...DP, plans: [best, TWO_STOP] };
    const cands = candidatesOf(weatherField(() => 4, 0), CAR, dp, CONFIG);
    const has = (c: { policy: Policy }, kind: Trigger['kind']): boolean => c.policy.triggers.some((t) => t.kind === kind);
    const carriesNeutralised = (c: { policy: Policy }): boolean => NEUTRALISED.every((n) => c.policy.triggers.some((t) => json(t) === json(n)));

    // the best plan's own sequence: two candidates, with and without the two triggers
    const own = cands.filter((c) => json(c.policy.stops) === json(BEST.stops) && !has(c, 'rivalPits'));
    expect(own.map((c) => c.policy.triggers.map((t) => t.kind)), 'the best plan: two candidates').toHaveLength(2);
    const withTrigger = own.filter((c) => has(c, 'degradationOff'));
    const without = own.filter((c) => !has(c, 'degradationOff'));
    expect(withTrigger, 'with the triggers').toHaveLength(1);
    expect(without, 'without the triggers').toHaveLength(1);
    expect(withTrigger[0]!.policy.triggers.filter((t) => t.kind === 'degradationOff' || t.kind === 'rain').map(json).sort()).toEqual([DEG_OFF, RAIN_THRESHOLD(9_000)].map(json).sort());
    expect(has(without[0]!, 'rain'), 'without: no rain trigger').toBe(false);
    for (const c of own) expect(carriesNeutralised(c), json(c.policy.triggers)).toBe(true);

    // every other candidate: neutralised triggers only (a cover or extend rule adds its own rivalPits); a neighbour or
    // rule the best plan's, another DP plan its own
    const others = cands.filter((c) => !own.includes(c));
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) {
      const at = `${c.source} ${json(c.policy.stops)}: ${json(c.policy.triggers.map((t) => t.kind))}`;
      expect(c.policy.triggers.every((t) => t.kind === 'neutralised' || t.kind === 'rivalPits'), at).toBe(true);
      if (c.source !== 'dp') expect(carriesNeutralised(c), at).toBe(true);
    }
    const twoStop = others.find((c) => c.source === 'dp' && json(c.policy.stops) === json(TWO_STOP.stops))!;
    expect(twoStop.policy.triggers, 'the two-stop: its own triggers, not the best plan\'s').toEqual(TWO_STOP_NEUTRALISED);
  });

  it("one close gap (SP4.3c Task 3, C43, C47): the job's cover and extend rules read race-interaction's closeGapMs; strategy has no ruleGapMs", () => {
    expect(Object.keys(STRATEGY_CONFIG.defaults)).not.toContain('ruleGapMs');
    const view = viewAt(RACE(), 3, { config: { maxScenarioPolicies: TEST_CAP } });
    const withinOf = (config: Record<string, Record<string, number>>): number[] => {
      const input = prepareStrategy({ ...view, config: { ...view.config, ...config } });
      const { mc } = candidatesForRun(structuredClone(input), createRng(2_025));
      expect(mc, 'a run').not.toBeNull();
      return Object.values(mc!.candidates).flatMap((list) => list.flatMap((c) => c.policy.triggers.flatMap((t) => (t.kind === 'rivalPits' ? [t.withinMs] : []))));
    };
    const byDefault = withinOf({});
    expect(byDefault.length, 'cover and extend rules').toBeGreaterThan(0);
    expect(new Set(byDefault)).toEqual(new Set([3_000]));
    expect(new Set(withinOf({ [RACE_INTERACTION_CONFIG.key]: { closeGapMs: 60_000 } }))).toEqual(new Set([60_000]));
  });

  // row 5
  it('on the generator test race the candidate count per car is at most dpPlansMax + neighbours + rules + 2', () => {
    const config = STRATEGY_CONFIG.defaults;
    // dpPlansMax: the config's (8, row 1); neighbours: one stop of the best plan (at most maxStops) moved
    // neighbourMinLaps…neighbourMaxLaps either way; rules: mirror ahead, mirror behind, cover, extend; 2: boxThisLap and continue
    const dpPlansMax = 8;
    const neighbours = 2 * (config.neighbourMaxLaps - config.neighbourMinLaps + 1) * config.maxStops;
    const bound = dpPlansMax + neighbours + 4 + 2;
    // our cars hold 4 inter and 3 wet sets besides the dry ones, as at Spa and Texas (the diagnosis' 73–136 candidates)
    const wetSet = (c: 'inter' | 'wet'): TyreSet => ({ ...SETS[3]!, actualCompound: c, visualCompound: c, fitted: false });
    const sets = [...SETS, ...Array.from({ length: 4 }, () => wetSet('inter')), ...Array.from({ length: 3 }, () => wetSet('wet'))];
    for (const lap of [3, 8]) {
      const input = prepareStrategy(viewAt(RACE(), lap, { config: { maxScenarioPolicies: TEST_CAP }, sets: { [PLAYER]: sets, [TEAMMATE]: sets } }));
      const { mc } = candidatesForRun(structuredClone(input), createRng(2_025));
      expect(mc, `lap ${lap}: a run`).not.toBeNull();
      const perCar = Object.entries(mc!.candidates).filter(([, list]) => list.length > 0);
      expect(perCar.length, `lap ${lap}: cars planned`).toBeGreaterThan(0);
      for (const [car, list] of perCar) expect(list.length, `lap ${lap}, car ${car}`).toBeLessThanOrEqual(bound);
    }
  });
});
