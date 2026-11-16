// `strategy`'s candidates from named sources (SP4.3c Task 20, spec §5.4, supervisor ruling R59; C43): every base plan
// of each stop count and weather world (`dpPlansMax` bounds a stop count, never across), stop-lap neighbours and mirrors
// as `strategy-dp` `bestWith` queries, mirrors with the rival's stop lap **and compound** from `race-monte-carlo`'s
// `rivalPlainPolicy`. A candidate's policy is a stop list (SP4.3d spec §5.1): the cover and extend rules are deleted
// with the triggers (SP4.3d1 Task 3). How these tests read `candidatesOf`, and the field and DP solves they use:
// `./candidates-support.ts`.
//
// Ported in SP4.3c Task 20 (C82): the rows that asserted the copy of the best plan's triggers onto neighbours and rules
// (SP4.3c Task 19's port) and the across-stop-count `dpPlansMax` (Task 23a row 1) are replaced by rows 1–3; Task 23a's
// rain filter, its best-plan trigger variants, the one close gap and the count bound stay, on the new field and
// signature. SP4.3d1 Task 3 deletes the rows of the trigger mechanism (the zero-stop's box trigger, cover and extend,
// the best plan's trigger variants, the cover and extend rules' gap) and ports the rest to stop lists.
import { known, type McSource, type Policy, type StartingPoint, type TyreSet } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { rivalPlainPolicy } from '../../src/race-monte-carlo/index.ts';
import { STRATEGY_DP_CONFIG } from '../../src/strategy-dp/config.ts';
import { bestWith, type DpPlan, type DpResult, type DpSolution } from '../../src/strategy-dp/index.ts';
import { policyOf } from '../../src/strategy/candidates.ts';
import { STRATEGY_CONFIG } from '../../src/strategy/config.ts';
import { prepareStrategy } from '../../src/strategy/index.ts';
import { candidatesForRun } from '../../src/strategy/job.ts';
import {
  AHEAD,
  AHEAD_STOP,
  BEHIND,
  BEHIND_OWN_STOP,
  BEHIND_STOP,
  CAR,
  candidatesOf,
  CONFIG,
  expectedMirror,
  field,
  fieldWithBehind,
  input,
  LAP,
  LAPS,
  solved,
} from './candidates-support.ts';
import { json, once, PLAYER, RACE, SETS, stopIn, TEAMMATE, TEST_CAP, viewAt } from './support.ts';

type Cand = { policy: Policy; source: McSource; rule: string | null };

/** The real solves on the field, computed once. */
const S = once(() => solved(input()));
const candidates = once(() => candidatesOf(field(), CAR, S().dp, S().solutions, CONFIG) as Cand[]);

const plan = (stops: DpPlan['stops'], expectedMs: number, world = 0): DpPlan => ({ stops, expectedMs, world });

/** The `bestWith` policies whose first stop is `first`, one per world of `solutions` that gives one. */
function bestWithPolicies(solutions: readonly DpSolution[], first: { lap: number; compound: DpPlan['stops'][number]['compound'] }): string[] {
  return solutions.flatMap((s) => {
    const q = bestWith(s, { stopLap: first.lap, compound: first.compound });
    return q === null ? [] : [json(policyOf(q))];
  });
}

/** The plans of `dp` per world and stop count, each group best first. */
function groups(plans: readonly DpPlan[]): Map<string, DpPlan[]> {
  const out = new Map<string, DpPlan[]>();
  for (const p of plans) {
    const key = `world ${p.world}, ${p.stops.length} stops`;
    out.set(key, [...(out.get(key) ?? []), p]);
  }
  for (const list of out.values()) list.sort((a, b) => a.expectedMs - b.expectedMs);
  return out;
}

/**
 * Each mirror's policy is among `cands` exactly once, labelled by the first source in candidate order that has it
 * (`expectedMirror`; ruling R18, "no policy twice"): its rule unless a base plan or a neighbour has the same policy.
 */
function expectMirrors(cands: readonly Cand[], mirrors: readonly (readonly ['mirrorAhead' | 'mirrorBehind', { lap: number; compound: DpPlan['stops'][number]['compound'] }])[]): void {
  for (const [rule, stop] of mirrors) {
    const expected = expectedMirror(S(), CONFIG, rule, stop);
    expect(expected, `${rule}: bestWith gives a plan`).not.toBeNull();
    const withPolicy = cands.filter((c) => json(c.policy) === expected!.policy);
    expect(withPolicy, `${rule}: its policy once`).toHaveLength(1);
    expect({ source: withPolicy[0]!.source, rule: withPolicy[0]!.rule }, rule).toEqual({ source: expected!.source, rule: expected!.rule });
    expect(withPolicy[0]!.policy.stops[0], rule).toEqual(stop);
    if (expected!.source !== 'rule') expect(cands.filter((c) => c.rule === rule), `${rule}: no rule row besides`).toHaveLength(0);
  }
}

/** Whether a base (`dp`) candidate is plan `p`: its stops, nothing else. */
const isBaseOf = (c: Cand, p: DpPlan): boolean => c.source === 'dp' && json(c.policy) === json({ stops: p.stops });

describe('strategy: candidates from named sources (SP4.3c Task 20)', () => {
  // row 1
  it('every stop count and world keeps its base plans: a zero-stop plan ranking 15th or worse by expected time is a candidate', () => {
    const { dp } = S();
    const cands = candidates();
    // the precondition: the DP's zero-stop plan ranks 15th or worse among all its plans
    const ranked = [...dp.plans].sort((a, b) => a.expectedMs - b.expectedMs);
    const zero = ranked.findIndex((p) => p.stops.length === 0);
    expect(zero, 'the zero-stop plan exists').toBeGreaterThanOrEqual(0);
    expect(zero + 1, "the zero-stop plan's rank").toBeGreaterThanOrEqual(15);
    expect(cands.some((c) => c.source === 'dp' && c.policy.stops.length === 0), 'a zero-stop base candidate').toBe(true);
    // every world and stop count with a plan: its best min(dpPlansMax, count) plans are base candidates, each its own
    for (const [key, list] of groups(dp.plans)) {
      for (const p of list.slice(0, CONFIG.dpPlansMax)) expect(cands.some((c) => isBaseOf(c, p)), `${key}: ${json(p.stops)}`).toBe(true);
    }
  });

  // row 1, the cap
  it('dpPlansMax caps the base plans per world and stop count, never across stop counts', () => {
    const { solutions } = S();
    // world 0: ten one-stops, four two-stops, the zero-stop 15th; world 1: a one-stop and the zero-stop
    const oneStops = Array.from({ length: 10 }, (_, i) => plan([{ lap: 22 + i, compound: 'hard' }], 1_000 + 10 * i));
    const twoStops = Array.from({ length: 4 }, (_, i) => plan([{ lap: 23 + i, compound: 'soft' }, { lap: 40, compound: 'hard' }], 2_000 + 10 * i));
    const zeroStop = plan([], 5_000);
    const world1 = [plan([{ lap: 41, compound: 'medium' }], 5_500, 1), plan([], 6_000, 1)];
    const boxThisLap = plan([{ lap: 19, compound: 'soft' }, { lap: 34, compound: 'medium' }], 3_000);
    const cont = plan([{ lap: 37, compound: 'medium' }], 4_000);
    const dp: DpResult = { plans: [...oneStops, ...twoStops, zeroStop, ...world1], boxThisLap, continue: cont, table: S().dp.table };
    expect([...dp.plans].sort((a, b) => a.expectedMs - b.expectedMs).indexOf(zeroStop), 'the zero-stop 15th').toBe(14);
    for (const max of [8, 3]) {
      const config = { ...CONFIG, dpPlansMax: max };
      const cands = candidatesOf(field(), CAR, dp, solutions, config) as Cand[];
      for (const [key, list] of groups(dp.plans)) {
        for (const p of list.slice(0, max)) expect(cands.some((c) => isBaseOf(c, p)), `max ${max}, ${key}: kept ${json(p.stops)}`).toBe(true);
        for (const p of list.slice(max)) expect(cands.some((c) => c.source === 'dp' && json(c.policy.stops) === json(p.stops)), `max ${max}, ${key}: dropped ${json(p.stops)}`).toBe(false);
      }
      // box this lap and continue besides
      for (const p of [boxThisLap, cont]) expect(cands.some((c) => isBaseOf(c, p)), `max ${max}: ${json(p.stops)}`).toBe(true);
    }
  });

  // row 2
  it("mirror ahead and behind: the first stop on the rival's plain stop lap and compound (lap 33 for inters; lap 27 for softs)", () => {
    const start = field();
    // the precondition: race-monte-carlo's one rival policy gives these first stops
    expect(rivalPlainPolicy(start, AHEAD, null).stops[0]).toEqual(AHEAD_STOP);
    expect(rivalPlainPolicy(start, BEHIND, null).stops[0]).toEqual(BEHIND_STOP);
    // SP4.3d1 Task 3 (ruling R18): a mirror's policy is a candidate, labelled by the first source that has it, so on
    // this field the behind-mirror `[27 soft, 37 medium]` is a base plan (`dp`) and the ahead-mirror its rule
    const cands = candidates();
    expectMirrors(cands, [['mirrorAhead', AHEAD_STOP], ['mirrorBehind', BEHIND_STOP]]);
    expect(expectedMirror(S(), CONFIG, 'mirrorBehind', BEHIND_STOP)?.source, 'the precondition: the behind-mirror is a base plan').toBe('dp');
    expect(expectedMirror(S(), CONFIG, 'mirrorAhead', AHEAD_STOP)?.source, 'the precondition: the ahead-mirror is no base plan').toBe('rule');
  });

  // row 2, R18: a behind-mirror that differs from every DP plan carries its label
  it('a behind-mirror unlike every DP plan and neighbour (lap 25 for softs) is one candidate labelled mirrorBehind', () => {
    const start = fieldWithBehind(BEHIND_OWN_STOP);
    expect(rivalPlainPolicy(start, BEHIND, null).stops[0]).toEqual(BEHIND_OWN_STOP);
    const { dp, solutions } = S();
    const expected = expectedMirror(S(), CONFIG, 'mirrorBehind', BEHIND_OWN_STOP);
    expect(expected?.source, 'the precondition: no base plan or neighbour has its policy').toBe('rule');
    expect(dp.plans.some((p) => json(policyOf(p)) === expected!.policy), 'the precondition: no DP plan at all has its policy').toBe(false);
    const cands = candidatesOf(start, CAR, dp, solutions, CONFIG) as Cand[];
    const behind = cands.filter((c) => c.rule === 'mirrorBehind');
    expect(behind, 'one mirrorBehind candidate').toHaveLength(1);
    expect(behind[0]).toEqual({ policy: JSON.parse(expected!.policy) as Policy, source: 'rule', rule: 'mirrorBehind' });
    expect(behind[0]!.policy.stops[0]).toEqual(BEHIND_OWN_STOP);
    expect(new Set(cands.map((c) => json(c.policy))).size, 'no policy twice').toBe(cands.length);
  });

  // row 3
  it("a neighbour's and a mirror's plan is bestWith's for their first stop", () => {
    const { dp, solutions } = S();
    const cands = candidates();
    const policies = new Set(cands.map((c) => json(c.policy)));
    // the best plan's first stop moved neighbourMinLaps–neighbourMaxLaps laps either way, on its compound: bestWith's plan
    const best = [...dp.plans].sort((a, b) => a.expectedMs - b.expectedMs)[0]!;
    const first = best.stops[0]!;
    expect(first, 'the precondition: the best plan stops').toBeDefined();
    let found = 0;
    for (let d = CONFIG.neighbourMinLaps; d <= CONFIG.neighbourMaxLaps; d++) {
      for (const lap of [first.lap - d, first.lap + d]) {
        const q = bestWith(solutions[best.world]!, { stopLap: lap, compound: first.compound });
        if (q === null) continue;
        found++;
        expect(policies.has(json(policyOf(q))), `the neighbour on lap ${lap}: ${json(policyOf(q))}`).toBe(true);
      }
    }
    expect(found, 'neighbours').toBeGreaterThan(0);
    const neighbours = cands.filter((c) => c.source === 'neighbour');
    expect(neighbours.length).toBeGreaterThan(0);
    for (const c of [...neighbours, ...cands.filter((x) => x.rule === 'mirrorAhead' || x.rule === 'mirrorBehind')]) {
      const at = `${c.source} ${c.rule ?? ''} ${json(c.policy.stops)}`;
      expect(bestWithPolicies(solutions, c.policy.stops[0]!), at).toContain(json(c.policy));
    }
  });

  // SP4.3d1 Task 3 row 3 (spec §5.1): the cover and extend rules are deleted; the mirrors stay
  it('candidates: no candidate of source rule has rule cover or extend; mirror ahead and behind unchanged', () => {
    const cands = candidates();
    const rules = cands.filter((c) => c.source === 'rule');
    for (const c of rules) expect(['mirrorAhead', 'mirrorBehind'], json(c.policy)).toContain(c.rule);
    for (const c of rules) expect(['cover', 'extend'], json(c.policy)).not.toContain(c.rule);
    // the mirrors unchanged, each labelled by the first source with its policy (R18): here the ahead-mirror only
    expect(rules.map((c) => c.rule)).toEqual(['mirrorAhead']);
    expectMirrors(cands, [['mirrorAhead', AHEAD_STOP], ['mirrorBehind', BEHIND_STOP]]);
    // with a behind-mirror unlike every DP plan, both rules
    const own = candidatesOf(fieldWithBehind(BEHIND_OWN_STOP), CAR, S().dp, S().solutions, CONFIG) as Cand[];
    expect(own.filter((c) => c.source === 'rule').map((c) => c.rule).sort()).toEqual(['mirrorAhead', 'mirrorBehind']);
    // every candidate's policy is a stop list
    for (const c of cands) expect(Object.keys(c.policy), json(c.policy)).not.toContain('triggers');
  });

  // row 4
  it('the committed row is unchanged: the followed commit first, source committed, no other candidate with its policy', () => {
    const view = viewAt(RACE(), 3, { config: { maxScenarioPolicies: TEST_CAP } });
    const p = stopIn(view, PLAYER, 4);
    const input = prepareStrategy(viewAt(RACE(), 3, { config: { maxScenarioPolicies: TEST_CAP }, decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: p }] }));
    const { mc, perCar } = candidatesForRun(structuredClone(input), createRng(2_025));
    expect(mc, 'a run').not.toBeNull();
    const list = mc!.candidates[PLAYER]!;
    expect(list[0]).toEqual({ policy: perCar.get(PLAYER)!.followed, source: 'committed', rule: null });
    expect(perCar.get(PLAYER)!.original).toEqual(p);
    expect(list.filter((c) => c.source === 'committed')).toHaveLength(1);
    expect(list.filter((c) => json(c.policy) === json(list[0]!.policy))).toHaveLength(1);
    // the uncommitted teammate: no committed row
    expect(mc!.candidates[TEAMMATE]!.some((c) => c.source === 'committed')).toBe(false);
  });

  it('every candidate is one of a named source; no policy twice', () => {
    const cands = candidates();
    for (const c of cands) {
      if (c.source === 'rule') expect(['mirrorAhead', 'mirrorBehind'], json(c.policy)).toContain(c.rule);
      else {
        expect(['dp', 'neighbour'], json(c.policy)).toContain(c.source);
        expect(c.rule, json(c.policy)).toBeNull();
      }
    }
    expect(new Set(cands.map((c) => json(c.policy))).size).toBe(cands.length);
  });
});

// SP4.3b Task 23a (the end-of-run strategy defects; supervisor rulings 2026-11-13), ported to SP4.3c Task 20 and to
// stop lists in SP4.3d1 Task 3: inter and wet plans only where rain can come; a bound on the candidate count.
//
// How these rows read the rulings (the test agent's decisions, Task 23a report; ported in SP4.3c Tasks 19 and 20):
// - Without the DP's rain threshold (deleted with the triggers, SP4.3d1 Task 3), rain can come where `track-wetness`
//   calls the track wet or `rain-outlook`'s rule sees rain coming. The dry case keeps the forecast's highest rainPct (4,
//   below `rain-outlook`'s 40) and a dry track; the rain cases a forecast of 100 % from lap 25 or a wet track (600 ms).
// - The dry case's solves have no inter set (so no `bestWith` play fits one); the rivals' plain stops onto inters and
//   softs: a mirror onto inters is an inter candidate, filtered like every other.
const isWetStop = (s: { compound: string }): boolean => s.compound === 'inter' || s.compound === 'wet';

const BEST = plan([{ lap: 31, compound: 'hard' }], 1_000);
const TWO_STOP = plan([{ lap: 26, compound: 'hard' }, { lap: 38, compound: 'medium' }], 2_000);
const BOX_NOW = plan([{ lap: 19, compound: 'hard' }], 3_000);
const STAY_OUT = plan([{ lap: 44, compound: 'hard' }], 4_000);

/** The field with inter and wet sets for car 2, the forecast's rain chance per lap from `rainPct(lap)`, and the current wetness. */
function weatherField(rainPct: (lap: number) => number, wetnessMs: number): StartingPoint {
  const start = field();
  start.sets[CAR] = [...(start.sets[CAR] ?? []), ...Array.from({ length: 4 }, () => ({ compound: 'inter' as const, wearPct: 0 })), ...Array.from({ length: 3 }, () => ({ compound: 'wet' as const, wearPct: 0 }))];
  const byLap = Array.from({ length: LAPS - LAP + 1 }, (_, i) => ({ lap: LAP + i, rainPct: rainPct(LAP + i) }));
  return { ...start, weather: known({ byLap, accuracy: 'perfect' as const }, 0), wetness: { wetnessMs, sdMs: 0, wet: wetnessMs > 0 } };
}

/** A DP result with the dry plans above and three inter/wet plans (the second best a shower hedge). */
function wetDp(): DpResult {
  const interThenMedium = plan([{ lap: 28, compound: 'inter' }, { lap: 33, compound: 'medium' }], 1_500);
  const inter = plan([{ lap: 29, compound: 'inter' }], 2_500);
  const wet = plan([{ lap: 34, compound: 'wet' }], 3_500);
  return { plans: [BEST, interThenMedium, TWO_STOP, inter, wet], boxThisLap: BOX_NOW, continue: STAY_OUT, table: S().dp.table };
}
const WET_PLANS = (dp: DpResult): DpPlan[] => dp.plans.filter((p) => p.stops.some(isWetStop));

/** The dry solves: no inter set. */
const DRY = once(() => solved(input(field(), { soft: 2, medium: 2, hard: 2 })));

describe('strategy: candidates (Task 23a, ported)', () => {
  // row 2
  it("in a dry race (the forecast's highest rainPct below rain-outlook's threshold, a dry track) no candidate has an inter or wet stop", () => {
    const dp = wetDp();
    const cands = candidatesOf(weatherField(() => 4, 0), CAR, dp, DRY().solutions, CONFIG) as Cand[];
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(c.policy.stops.some(isWetStop), `${c.source} ${c.rule ?? ''}: ${json(c.policy.stops)}`).toBe(false);
    // the dry plans stay
    for (const p of [BEST, TWO_STOP]) expect(cands.some((c) => c.source === 'dp' && json(c.policy.stops) === json(p.stops)), json(p.stops)).toBe(true);
  });

  // row 3
  it('with rain forecast or a wet track, inter/wet plans are candidates', () => {
    const dp = wetDp();
    for (const [what, start] of [
      ['rain forecast from lap 25', weatherField((lap) => (lap >= 25 ? 100 : 0), 0)],
      ['the track already wet', weatherField(() => 0, 600)],
    ] as const) {
      const cands = candidatesOf(start, CAR, dp, S().solutions, CONFIG) as Cand[];
      for (const p of WET_PLANS(dp)) {
        expect(cands.some((c) => c.source === 'dp' && json(c.policy.stops) === json(p.stops)), `${what}: ${json(p.stops)}`).toBe(true);
      }
    }
  });

  // row 5
  it('on the generator test race the candidate count per car is at most worlds × stop counts × dpPlansMax + 2 + neighbours + rules + 1', () => {
    const config = STRATEGY_CONFIG.defaults;
    // per world and stop count (0–3) dpPlansMax base plans, boxThisLap and continue; neighbours: the best plan's first
    // stop moved neighbourMinLaps…neighbourMaxLaps either way; rules: mirror ahead, mirror behind; the commit
    const worlds = STRATEGY_DP_CONFIG.defaults.worlds;
    const neighbours = 2 * (config.neighbourMaxLaps - config.neighbourMinLaps + 1);
    const bound = worlds * 4 * config.dpPlansMax + 2 + neighbours + 2 + 1;
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
