// The strategy table's fields (SP4.3b2 Task 6 rows 6–9; spec §10, mockup strategy-table-b; C43): `strategy` fills each
// row's `rank`, `deltaLeaderMs`, `deltaPlanMs` and `rule`, and per car `currentPosition`, so the display computes none.
//
// How these rows read the task (the test agent's decisions, Task 6 report):
// - Row 6 sets the ranking's tie flags (the job calls `race-monte-carlo` through its index, mocked here to change the
//   real result's `tie` flags only): leader, tie, tie, no tie, no tie, … gives ranks 1, 1, 1, 4, 5, then index + 1.
// - Row 7 also checks the other rows' deltas: `deltaPlanMs` = `meanMs` − the committed row's, `deltaLeaderMs` =
//   `meanMs` − `rows[0]`'s.
// - Row 8: "the car's position at the trigger" is the car's race position in the live state of the view `prepare`
//   reads (`timing.position`); the view here gives our player car a race position (7) that is not its place in the
//   starting point's order (3), so the value must come from the trigger's view, not from the order.
// - Row 9: on the hand-built field of `candidates.test.ts`, the four rule candidates carry `mirrorAhead`,
//   `mirrorBehind`, `cover`, `extend`; every other candidate `null`; on the job's output every `rule` row carries one of
//   the four, every other row `null`.
import { carId, type CarId, type StartingPoint, type StrategyOutput, type Trigger } from '@pitwall/domain';
import { createRng, type EngineView } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { DpPlan, DpResult } from '../../src/strategy-dp/index.ts';
import { candidatesOf, policyOf, prepareStrategy, runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { json, PLAYER, RACE, stopIn, TEAMMATE, viewAt, type ViewSpec } from './support.ts';

/** When set, the tie flags `race-monte-carlo`'s rows get, best first (the rest `false`). */
const mock = vi.hoisted(() => ({ ties: null as boolean[] | null }));

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    raceMonteCarlo: (...args: Parameters<typeof real.raceMonteCarlo>) => {
      const result = real.raceMonteCarlo(...args);
      const ties = mock.ties;
      if (ties === null) return result;
      return Object.fromEntries(
        Object.entries(result).map(([car, r]) => [car, { ...r, rows: r.rows.map((row, i) => ({ ...row, tie: i > 0 && (ties[i] ?? false) })) }]),
      );
    },
  };
});

beforeEach(() => {
  mock.ties = null;
});

const SEED = 1_521_242_744;
const LAP = 3;

function planned(spec: ViewSpec = {}, lap = LAP, edit: (view: EngineView) => EngineView = (v) => v): StrategyOutput {
  const input = structuredClone(prepareStrategy(edit(viewAt(RACE(), lap, spec))));
  return runStrategy(input, createRng(SEED));
}

function entryOf(out: StrategyOutput, car: CarId) {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
}

describe('strategy: the table fields', () => {
  // row 6
  it("rank: tied rows share their leader's rank, the next untied row gets its index + 1 (mockup: 1, 1, 1, 4, 5)", () => {
    mock.ties = [false, true, true, false, false];
    const { rows } = entryOf(planned(), PLAYER);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.slice(0, 5).map((r) => r.tie)).toEqual([false, true, true, false, false]);
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => (i < 3 ? 1 : i + 1)));
  });

  // row 7
  it('deltaPlanMs is null without a commit and 0 on the committed row', () => {
    const free = entryOf(planned(), PLAYER).rows;
    for (const r of free) expect(r.deltaPlanMs).toBeNull();
    const view = viewAt(RACE(), LAP);
    const policy = stopIn(view, PLAYER, 4);
    const { rows } = entryOf(planned({ decisions: [{ kind: 'planCommitted', carId: PLAYER, policy }] }), PLAYER);
    const committed = rows.filter((r) => r.committed);
    expect(committed).toHaveLength(1);
    const plan = committed[0]!;
    expect(plan.deltaPlanMs).toBe(0);
    const leader = rows[0]!;
    for (const r of rows) {
      expect(r.deltaPlanMs, json(r.policy.stops)).toBeCloseTo(r.meanMs - plan.meanMs, 6);
      expect(r.deltaLeaderMs, json(r.policy.stops)).toBeCloseTo(r.meanMs - leader.meanMs, 6);
    }
    expect(rows.some((r) => r.deltaLeaderMs !== 0)).toBe(true);
  });

  // row 8
  it("currentPosition is the car's position at the trigger", () => {
    const at = (position: number) => (view: EngineView): EngineView => ({
      ...view,
      live: {
        ...view.live,
        cars: view.live.cars.map((c) => (c.id === PLAYER ? { ...c, timing: { ...c.timing, position } } : c)),
      } as EngineView['live'],
    });
    const out = planned({}, LAP, at(7));
    expect(entryOf(out, PLAYER).currentPosition).toBe(7);
    // the teammate's, unchanged in the view
    const view = viewAt(RACE(), LAP);
    const mate = view.live.cars.find((c) => c.id === TEAMMATE)!;
    expect(entryOf(out, TEAMMATE).currentPosition).toBe(mate.timing.position);
  });

  // row 9
  it("a rule candidate's row carries its rule (mirrorAhead, mirrorBehind, cover, extend); every other row null", () => {
    // the hand-built field of candidates.test.ts: car 2, the rival ahead (1) likeliest to stop on lap 12, behind (3) on 22
    const CAR = carId(2);
    const start: StartingPoint = startingPoint({ lap: 5, lapsTotal: 30, cars: Array.from({ length: 8 }, () => ({})), ours: [2, 5] });
    start.stopLow[1] = 10;
    start.stopMid[1] = 12;
    start.stopHigh[1] = 14;
    start.stopLow[3] = 19;
    start.stopMid[3] = 22;
    start.stopHigh[3] = 25;
    const thresholds: Trigger[] = [{ kind: 'neutralised', condition: 'sc', fromLap: 6, toLap: 15, action: { box: 'hard' } }];
    const best: DpPlan = { stops: [{ lap: 16, compound: 'hard' }], expectedMs: 1_000 };
    const dp: DpResult = {
      plans: [best],
      boxNow: { stops: [{ lap: 5, compound: 'hard' }], expectedMs: 3_000 },
      stayOut: { stops: [{ lap: 26, compound: 'hard' }], expectedMs: 4_000 },
      thresholds,
      table: { boxUnderMs: new Float64Array(26), stayMs: new Float64Array(26) },
    };
    const config = { ...STRATEGY_CONFIG.defaults, ruleGapMs: 2_500 };
    const cands = candidatesOf(start, CAR, dp, config);
    const ruleOf = (policy: ReturnType<typeof policyOf>) => cands.find((c) => json(c.policy) === json(policy))?.rule;
    const at = (lap: number) => policyOf({ stops: [{ lap, compound: 'hard' }] }, thresholds);
    expect(ruleOf(at(12))).toBe('mirrorAhead');
    expect(ruleOf(at(22))).toBe('mirrorBehind');
    expect(ruleOf(policyOf(best, [...thresholds, { kind: 'rivalPits', carId: carId(3), withinMs: 2_500, action: 'cover' }]))).toBe('cover');
    expect(ruleOf(policyOf(best, [...thresholds, { kind: 'rivalPits', carId: carId(1), withinMs: 2_500, action: 'extend' }]))).toBe('extend');
    for (const c of cands) {
      if (c.source === 'rule') expect(c.rule, json(c.policy)).not.toBeNull();
      else expect(c.rule, json(c.policy)).toBeNull();
    }
    expect(cands.filter((c) => c.source === 'rule').map((c) => c.rule).sort()).toEqual(['cover', 'extend', 'mirrorAhead', 'mirrorBehind']);

    // the job's rows carry their candidate's rule
    const out = planned();
    for (const car of [PLAYER, TEAMMATE]) {
      for (const r of entryOf(out, car).rows) {
        if (r.source === 'rule') expect(['mirrorAhead', 'mirrorBehind', 'cover', 'extend'], json(r.policy)).toContain(r.rule);
        else expect(r.rule, json(r.policy)).toBeNull();
      }
    }
  });
});
