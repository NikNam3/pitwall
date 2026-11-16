// `strategy`'s job with plan slots (SP4.3d spec §5.3, §6.1; SP4.3d1 Task 5 rows 1, 4, 5 and 6; C1a, C43, C51, C76):
// each saved plan of a car (`planSlots(history, car)`) is one of its candidates and one row, with its slot and its
// source (`plan`, or `game` for G1 and G2); the active plan first; per car `bestPerStops` names per stop count the best
// row a DP, neighbour or rule candidate produced, so a DP plan equal to a slot points at that slot's row (the board's
// `= A`), and a slot-only row is never named. The race and views of `./support.ts`; every `race-monte-carlo` call is
// recorded (the real search runs), as in `strategy.test.ts`.
//
// How these rows read the job (the test agent's decisions, Task 5 report):
// - Slots enter through the view's decisions (`planSaved`; `planCommitted` with `slot` activates one), never through
//   another input: `prepareStrategy` reads them from the projection.
// - A call's slot candidate carries its `slot` (`McCandidate.slot`); its policy is the slot's as far as it can be
//   followed (a passed stop boxes this lap), as for a committed plan (`strategy.test.ts` row 13).
// - A row's stop count is `row.policy.stops.length`; "the best row" of a stop count is the first in the rows' order.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CarId, McRow, Policy, StrategyOutput } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { McInput, McResult } from '../../src/race-monte-carlo/index.ts';
import { prepareStrategy, runStrategy } from '../../src/strategy/index.ts';
import { currentLapOf, json, plannedIn, PLAYER, RACE, SETS, stopIn, viewAt, type ViewSpec } from './support.ts';

const calls = vi.hoisted(() => ({ list: [] as { input: McInput; result: McResult }[] }));

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    raceMonteCarlo: (...args: Parameters<typeof real.raceMonteCarlo>) => {
      const result = real.raceMonteCarlo(...args);
      calls.list.push({ input: args[0], result });
      return result;
    },
  };
});

beforeEach(() => {
  calls.list = [];
});

const SEED = 1_521_242_744;
const LAP = 3;

/** The job's output on the race's view at the leader's lap `lap`, as the worker computes it. */
function planned(spec: ViewSpec = {}, lap = LAP): StrategyOutput {
  const input = structuredClone(prepareStrategy(viewAt(RACE(), lap, spec)));
  return runStrategy(input, createRng(SEED));
}

type CarRows = Extract<StrategyOutput[CarId], { known: true }>['value'];

/** Car `car`'s entry; fails the test when it has none. */
function entryOf(out: StrategyOutput, car: CarId): CarRows {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
}

const same = (a: Policy, b: Policy): boolean => json(a) === json(b);
const saved = (slot: 'A' | 'B' | 'C' | 'G1' | 'G2', policy: Policy, carId: CarId = PLAYER) => ({ kind: 'planSaved' as const, carId, slot, policy });
const activated = (slot: 'A' | 'B' | 'C' | 'G1' | 'G2', policy: Policy, carId: CarId = PLAYER) => ({ kind: 'planCommitted' as const, carId, policy, slot });

/** The sources a DP, neighbour or rule candidate gives its row. */
const SEARCHED: readonly McRow['source'][] = ['dp', 'neighbour', 'rule'];
const STOP_COUNTS = [0, 1, 2, 3] as const;

/** Every final call's candidates of `car` (those of the calls that plan it). */
const candidatesIn = (car: CarId) => calls.list.filter((c) => plannedIn(c.input).includes(car)).map((c) => c.input.candidates[car] ?? []);

describe('strategy: plan slots in the job', () => {
  // row 1
  it('slots are rows: slots A, B, G1 saved → three rows with their slots, sources plan, plan, game', () => {
    const view = viewAt(RACE(), LAP);
    const a = stopIn(view, PLAYER, 4, 'hard');
    const b = stopIn(view, PLAYER, 7, 'medium');
    const g1: Policy = { stops: [{ lap: currentLapOf(view, PLAYER) + 3, compound: 'hard' }, { lap: currentLapOf(view, PLAYER) + 9, compound: 'soft' }] };
    const { rows } = entryOf(planned({ decisions: [saved('A', a), saved('B', b), saved('G1', g1)] }), PLAYER);
    const slotRows = rows.filter((r) => r.slot !== null);
    expect(slotRows.map((r) => r.slot).sort()).toEqual(['A', 'B', 'G1']);
    for (const [slot, policy, source] of [['A', a, 'plan'], ['B', b, 'plan'], ['G1', g1, 'game']] as const) {
      const found = rows.filter((r) => r.slot === slot);
      expect(found, `slot ${slot}`).toHaveLength(1);
      expect(found[0], `slot ${slot}`).toMatchObject({ policy, source, committed: false, infeasible: null });
      // one row per policy: no other row repeats a slot's plan
      expect(rows.filter((r) => same(r.policy, policy)), `slot ${slot}'s plan`).toHaveLength(1);
    }
    // every other row is no slot, from the search's own candidates
    for (const r of rows.filter((r) => r.slot === null)) expect(SEARCHED, json(r.policy)).toContain(r.source);
    // each final call of the car holds the three slots as candidates with their slots
    expect(candidatesIn(PLAYER).length).toBeGreaterThan(0);
    for (const cands of candidatesIn(PLAYER)) {
      expect(cands.filter((c) => c.slot !== undefined && c.slot !== null).map((c) => c.slot).sort()).toEqual(['A', 'B', 'G1']);
    }
  });

  // row 1: an active slot
  it('slots are rows: the active slot is its slot\'s row, committed, first among the candidates', () => {
    const view = viewAt(RACE(), LAP);
    const a = stopIn(view, PLAYER, 4, 'hard');
    const b = stopIn(view, PLAYER, 7, 'medium');
    const { rows } = entryOf(planned({ decisions: [saved('A', a), saved('B', b), activated('B', b)] }), PLAYER);
    const active = rows.filter((r) => r.committed);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ slot: 'B', source: 'plan', policy: b });
    expect(rows.filter((r) => r.source === 'committed'), 'source committed only for a plan committed without a slot').toEqual([]);
    expect(rows.filter((r) => r.slot === 'A')).toHaveLength(1);
    for (const cands of candidatesIn(PLAYER)) expect(cands[0]?.policy, 'the active plan first').toEqual(b);
  });

  // row 4 (Review Focus 1)
  it('infeasible: slot B\'s first stop passed → infeasible stopLapPassed, boxes this lap, still a row', () => {
    const lap12 = 12;
    const view = viewAt(RACE(), lap12);
    const lap = currentLapOf(view, PLAYER);
    const a = stopIn(view, PLAYER, 3, 'hard');
    const b: Policy = { stops: [{ lap: lap - 2, compound: 'hard' }, { lap: lap + 4, compound: 'medium' }] };
    const { rows } = entryOf(planned({ decisions: [saved('A', a), saved('B', b), activated('A', a)] }, lap12), PLAYER);
    const bRows = rows.filter((r) => r.slot === 'B');
    expect(bRows, 'slot B is still a row').toHaveLength(1);
    expect(bRows[0]).toMatchObject({ source: 'plan', infeasible: 'stopLapPassed', committed: false });
    // its ΔPOS is still against the active plan (slot A)
    expect(bRows[0]!.diffPlan.known).toBe(true);
    // followed as far as it can be: the passed stop boxes this lap, the later stop as saved
    expect(candidatesIn(PLAYER).length).toBeGreaterThan(0);
    for (const cands of candidatesIn(PLAYER)) {
      const slotB = cands.filter((c) => c.slot === 'B');
      expect(slotB).toHaveLength(1);
      expect(slotB[0]!.policy.stops).toEqual([{ lap, compound: 'hard' }, { lap: lap + 4, compound: 'medium' }]);
    }
  });

  // row 4: no set of the compound left
  it('infeasible: a slot onto a compound without a set left → infeasible noSetLeft, still a row', () => {
    const view = viewAt(RACE(), LAP);
    const onHard = stopIn(view, PLAYER, 4, 'hard');
    const noHard = SETS.filter((s) => s.visualCompound !== 'hard');
    const { rows } = entryOf(planned({ sets: { [PLAYER]: noHard }, decisions: [saved('C', onHard)] }), PLAYER);
    const c = rows.filter((r) => r.slot === 'C');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ source: 'plan', infeasible: 'noSetLeft' });
  });

  // row 5
  it('per stop count: bestPerStops names the best DP, neighbour or rule row of each stop count; a slot-only row (G1 entered by hand) is never named', () => {
    const view = viewAt(RACE(), LAP);
    const lap = currentLapOf(view, PLAYER);
    // a game plan no search candidate is: a one-lap stint on softs
    const g1: Policy = { stops: [{ lap: lap + 1, compound: 'soft' }, { lap: lap + 2, compound: 'hard' }] };
    planned();
    for (const cands of candidatesIn(PLAYER)) expect(cands.some((c) => same(c.policy, g1)), 'G1 is no search candidate').toBe(false);
    calls.list = [];

    const { rows, bestPerStops } = entryOf(planned({ decisions: [saved('G1', g1)] }), PLAYER);
    const g1At = rows.findIndex((r) => r.slot === 'G1');
    expect(g1At, 'G1 is a row').toBeGreaterThanOrEqual(0);
    expect(rows[g1At]).toMatchObject({ source: 'game', policy: g1 });
    expect(Object.values(bestPerStops), 'G1 is never named').not.toContain(g1At);
    for (const k of STOP_COUNTS) {
      const best = rows.findIndex((r) => SEARCHED.includes(r.source) && r.policy.stops.length === k);
      if (best === -1) expect(bestPerStops[k], `${k} stops: no row`).toBeUndefined();
      else expect(bestPerStops[k], `${k} stops`).toBe(best);
    }
    // the race has rows of more than one stop count: the map is not empty
    expect(Object.keys(bestPerStops).length).toBeGreaterThan(1);
  });

  // row 6
  it("dedup: the DP's best equals slot A → one row, slot A, and bestPerStops for its stop count is that row's index", () => {
    const first = entryOf(planned(), PLAYER).rows[0]!;
    expect(SEARCHED, "the run's best is a DP-produced row").toContain(first.source);
    const a = first.policy;
    const k = a.stops.length as 0 | 1 | 2 | 3;
    calls.list = [];

    const { rows, bestPerStops } = entryOf(planned({ decisions: [saved('A', a)] }), PLAYER);
    const found = rows.map((r, i) => ({ r, i })).filter(({ r }) => same(r.policy, a));
    expect(found, 'one row for the plan').toHaveLength(1);
    expect(found[0]!.r).toMatchObject({ slot: 'A', source: 'plan' });
    expect(bestPerStops[k], `${k} stops: the slot's row`).toBe(found[0]!.i);
    // one candidate for the plan in every final call, labelled slot A
    for (const cands of candidatesIn(PLAYER)) {
      const twins = cands.filter((c) => same(c.policy, a));
      expect(twins).toHaveLength(1);
      expect(twins[0]!.slot).toBe('A');
    }
  });
});

// SP4.3d1 Task 5 F1, ruling R32 (C43): the active plan and its slot are `activePlan`'s (domain), the one answer the job,
// `strategy-overview` and the plan board share; the job keeps no own matching.
describe('strategy: the active plan is activePlan (R32)', () => {
  const committedAlone = (policy: Policy, carId: CarId = PLAYER) => ({ kind: 'planCommitted' as const, carId, policy });

  it('slot A saved, activated, then saved again with another policy → the committed policy (source committed, no slot) and slot A\'s new policy are two rows; ΔPOS and ΔTIME against the committed row', () => {
    const view = viewAt(RACE(), LAP);
    const first = stopIn(view, PLAYER, 4, 'hard');
    const again = stopIn(view, PLAYER, 7, 'medium');
    const { rows } = entryOf(planned({ decisions: [saved('A', first), activated('A', first), saved('A', again)] }), PLAYER);
    const active = rows.filter((r) => r.committed);
    expect(active, 'one active row').toHaveLength(1);
    expect(active[0]).toMatchObject({ policy: first, source: 'committed', slot: null, committed: true });
    const a = rows.filter((r) => r.slot === 'A');
    expect(a, "slot A's row").toHaveLength(1);
    expect(a[0]).toMatchObject({ policy: again, source: 'plan', committed: false });
    // ΔPOS and ΔTIME are taken against the committed row
    expect(active[0]!.diffPlan.known, 'the active row has no ΔPOS').toBe(false);
    expect(active[0]!.deltaPlanMs).toBe(0);
    expect(a[0]!.diffPlan.known, "slot A's ΔPOS").toBe(true);
    expect(a[0]!.deltaPlanMs).toBeCloseTo(a[0]!.meanMs - active[0]!.meanMs, 6);
    for (const cands of candidatesIn(PLAYER)) expect(cands[0]?.policy, 'the active plan first').toEqual(first);
  });

  it("a plan committed without a slot equal to slot B's policy → one row, slot B, committed", () => {
    const view = viewAt(RACE(), LAP);
    const a = stopIn(view, PLAYER, 4, 'hard');
    const b = stopIn(view, PLAYER, 7, 'medium');
    const { rows } = entryOf(planned({ decisions: [saved('A', a), saved('B', b), committedAlone(b)] }), PLAYER);
    const active = rows.filter((r) => r.committed);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ slot: 'B', source: 'plan', policy: b });
    expect(rows.filter((r) => same(r.policy, b)), "one row for slot B's plan").toHaveLength(1);
    expect(rows.filter((r) => r.source === 'committed')).toEqual([]);
    expect(rows.filter((r) => r.slot === 'A')).toMatchObject([{ policy: a, committed: false }]);
  });

  it('source: the job reads activePlan and keeps no own matching of the active plan to a slot', () => {
    const src = (path: string): string => readFileSync(join(import.meta.dirname, '../../src', path), 'utf8');
    const job = src('strategy/job.ts');
    const input = src('shared/strategy-input/input.ts');
    for (const call of ['activeSlot(', 'latestPlan(']) {
      expect(job, `job.ts calls ${call}`).not.toContain(call);
      expect(input, `strategy-input calls ${call}`).not.toContain(call);
    }
    expect(job + input, 'the job reads activePlan').toContain('activePlan(');
    expect(job, "job.ts matches the active plan to a slot itself (`PLAN_SLOTS.find`)").not.toContain('PLAN_SLOTS.find(');
  });
});
