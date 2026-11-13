// `strategy`'s candidates (SP4.3b spec §8.1 step 1, S21; plan 4.3b1 Task 20 row 1; 4.3b2 precondition 3): per car the
// DP's plans and its box-now and stay-out variants, their stop-lap neighbours ±1–3 laps, and the rule candidates
// mirror ahead, mirror behind, cover and extend on the best plan; every policy built by one function, `policyOf(plan,
// thresholds)`, with the DP's thresholds. A hand-built field (race-forecast's test builder) and a hand-made DP result,
// so every expected candidate is known (how they are read: `./support.ts`).
import { carId, type CarId, type McSource, type Policy, type StartingPoint, type Trigger } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { candidatesOf, policyOf } from '../../src/strategy/candidates.ts';
import { STRATEGY_CONFIG } from '../../src/strategy/config.ts';
import type { DpPlan, DpResult } from '../../src/strategy-dp/index.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { json } from './support.ts';

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

const THRESHOLDS: Trigger[] = [
  { kind: 'neutralised', condition: 'sc', fromLap: 6, toLap: 15, action: { box: 'hard' } },
  { kind: 'neutralised', condition: 'vsc', fromLap: 9, toLap: 14, action: { box: 'hard' } },
  { kind: 'damage', lossMsPerLap: 900, action: { box: 'hard' } },
];

const plan = (stops: DpPlan['stops'], expectedMs: number): DpPlan => ({ stops, expectedMs });

/** The DP's result for car 2: the best one-stop on lap 16, a two-stop, box now and stay out (its stop on lap 26). */
const BEST = plan([{ lap: 16, compound: 'hard' }], 1_000);
const TWO_STOP = plan([{ lap: 10, compound: 'hard' }, { lap: 21, compound: 'medium' }], 2_000);
const BOX_NOW = plan([{ lap: LAP, compound: 'hard' }], 3_000);
const STAY_OUT = plan([{ lap: 26, compound: 'hard' }], 4_000);
const DP: DpResult = {
  plans: [BEST, TWO_STOP],
  boxNow: BOX_NOW,
  stayOut: STAY_OUT,
  thresholds: THRESHOLDS,
  table: { boxUnderMs: new Float64Array(LAPS - LAP + 1), stayMs: new Float64Array(LAPS - LAP + 1) },
};

const CONFIG = { ...STRATEGY_CONFIG.defaults, ruleGapMs: 2_500 };

/** The candidate of `policy`; fails the test when there is none or more than one. */
function find(cands: readonly { policy: Policy; source: McSource }[], policy: Policy): { policy: Policy; source: McSource } {
  const found = cands.filter((c) => json(c.policy) === json(policy));
  expect(found, `candidates with ${json(policy)}`).toHaveLength(1);
  return found[0]!;
}

const moved = (p: DpPlan, k: number, lap: number): DpPlan => ({ ...p, stops: p.stops.map((s, i) => (i === k ? { ...s, lap } : s)) });

describe('strategy: candidates', () => {
  // row 1
  it('candidates per car: DP plans, boxNow, stayOut, neighbours ±1–3, mirror ahead, mirror behind, cover, extend; each with the DP\'s thresholds', () => {
    const start = field();
    const cands = candidatesOf(start, CAR, DP, CONFIG);
    // the DP's plans and its variants
    for (const p of [BEST, TWO_STOP, BOX_NOW, STAY_OUT]) expect(find(cands, policyOf(p, THRESHOLDS)).source, json(p.stops)).toBe('dp');
    // the best plan's stop-lap neighbours, 1 to 3 laps either way
    for (const d of [-3, -2, -1, 1, 2, 3]) expect(find(cands, policyOf(moved(BEST, 0, 16 + d), THRESHOLDS)).source, `lap ${16 + d}`).toBe('neighbour');
    // every neighbour is one stop of a DP plan or variant moved by 1 to 3 laps, the rest kept
    const bases = [BEST, TWO_STOP, BOX_NOW, STAY_OUT];
    for (const c of cands.filter((x) => x.source === 'neighbour')) {
      const isNeighbour = bases.some((b) =>
        b.stops.some((s, k) =>
          [-3, -2, -1, 1, 2, 3].some((d) => s.lap + d >= LAP && s.lap + d < LAPS && json(c.policy) === json(policyOf(moved(b, k, s.lap + d), THRESHOLDS))),
        ),
      );
      expect(isNeighbour, json(c.policy.stops)).toBe(true);
    }
    // the rules on the best plan: mirror the rival ahead and the one behind at their likeliest stop laps
    expect(find(cands, policyOf(moved(BEST, 0, 12), THRESHOLDS)).source).toBe('rule');
    expect(find(cands, policyOf(moved(BEST, 0, 22), THRESHOLDS)).source).toBe('rule');
    // cover the car behind and extend past the car ahead, within ruleGapMs (from the config)
    const cover: Trigger = { kind: 'rivalPits', carId: BEHIND, withinMs: 2_500, action: 'cover' };
    const extend: Trigger = { kind: 'rivalPits', carId: AHEAD, withinMs: 2_500, action: 'extend' };
    expect(find(cands, policyOf(BEST, [...THRESHOLDS, cover])).source).toBe('rule');
    expect(find(cands, policyOf(BEST, [...THRESHOLDS, extend])).source).toBe('rule');
    // nothing else: no committed row (the job adds it), no policy twice
    expect(new Set(cands.map((c) => c.source))).toEqual(new Set(['dp', 'neighbour', 'rule']));
    expect(new Set(cands.map((c) => json(c.policy))).size).toBe(cands.length);
  });

  // 4.3b2 precondition 3
  it("every candidate's policy is policyOf(its plan, the DP's thresholds)", () => {
    const cands = candidatesOf(field(), CAR, DP, CONFIG);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      // a rule's own trigger (cover, extend) joins the DP's thresholds
      const own = c.policy.triggers.filter((t) => t.kind === 'rivalPits');
      expect(c.policy, json(c.policy.stops)).toEqual(policyOf({ stops: c.policy.stops, expectedMs: 0 }, [...THRESHOLDS, ...own]));
    }
    // policyOf keeps the plan's stops and carries the thresholds
    const p = policyOf(TWO_STOP, THRESHOLDS);
    expect(p.stops).toEqual(TWO_STOP.stops);
    expect(p.triggers.length).toBeGreaterThan(0);
    for (const t of p.triggers) expect(THRESHOLDS.map(json)).toContain(json(t));
  });
});
