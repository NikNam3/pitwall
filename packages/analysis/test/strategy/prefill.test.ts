// The prefill of slots A and B (SP4.3d2 Task 9 row 2; SP4.3d spec §7.1 step 5; C43): `prefillOf(rows, bestPerStops,
// saved, infeasible)`, the one rule the planning job and the race's job share. A = the best row's policy; B = the better
// ranked (the lower row index) of `bestPerStops[stops(A) − 1]` and `bestPerStops[stops(A) + 1]`; each only for a slot that
// is empty or whose row is infeasible (`infeasible`). Pure.
//
// How this row reads the rule (the test agent's decisions, Task 9): "stops(A)" is the best row's stop count; a saved A
// here always has the best row's stop count, so B's neighbours are the same whichever A is read; a stop count without a
// `bestPerStops` entry is no neighbour; with neither neighbour B stays empty.
import { unknown, type McRow, type Policy } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { prefillOf } from '../../src/strategy/index.ts';

/** A ranked row of `policy` (the other fields plain: `prefillOf` reads the order and the policies). */
const row = (policy: Policy, i: number): McRow => ({
  policy,
  source: 'dp',
  slot: null,
  positionPmf: [1],
  ePos: 1 + i / 10,
  ePoints: 25 - i,
  meanMs: 5_400_000 + i * 1_000,
  quantiles: { p10: 1, p50: 1, p90: 2 },
  pGain: 0,
  diff: i / 10,
  se: 0.01,
  tie: false,
  committed: false,
  infeasible: null,
  rank: i + 1,
  deltaLeaderMs: i * 1_000,
  deltaPlanMs: null,
  diffPlan: unknown('notApplicable'),
  sePlan: unknown('notApplicable'),
  rule: null,
});
const rowsOf = (policies: readonly Policy[]): McRow[] => policies.map(row);

const ONE_STOP: Policy = { startCompound: 'medium', stops: [{ lap: 24, compound: 'hard' }] };
const ONE_STOP_LATER: Policy = { startCompound: 'medium', stops: [{ lap: 27, compound: 'hard' }] };
const TWO_STOPS: Policy = { startCompound: 'soft', stops: [{ lap: 14, compound: 'medium' }, { lap: 32, compound: 'hard' }] };
const NO_STOP: Policy = { startCompound: 'hard', stops: [] };
const THREE_STOPS: Policy = { startCompound: 'soft', stops: [{ lap: 10, compound: 'soft' }, { lap: 20, compound: 'medium' }, { lap: 32, compound: 'hard' }] };
const SAVED_A: Policy = { startCompound: 'hard', stops: [{ lap: 30, compound: 'medium' }] };
const SAVED_B: Policy = { startCompound: 'soft', stops: [{ lap: 18, compound: 'hard' }, { lap: 36, compound: 'medium' }] };

const NONE = new Set<'A' | 'B' | 'C' | 'G1' | 'G2'>();

describe('prefillOf (SP4.3d2 Task 9)', () => {
  // the best row a one-stop; the two-stop (index 2) ranks above the no-stop (index 3)
  const rows = rowsOf([ONE_STOP, ONE_STOP_LATER, TWO_STOPS, NO_STOP, THREE_STOPS]);
  const bestPerStops = { 1: 0, 2: 2, 0: 3, 3: 4 };

  it('2: prefill: no slots → A = the best row\'s policy, B = the better of its stop count ± 1', () => {
    expect(prefillOf(rows, bestPerStops, {}, NONE)).toEqual({ A: ONE_STOP, B: TWO_STOPS });
  });

  it('2: prefill: B is the better ranked neighbour, whichever stop count it has', () => {
    // the no-stop now ranks above the two-stop
    const swapped = rowsOf([ONE_STOP, NO_STOP, ONE_STOP_LATER, TWO_STOPS]);
    expect(prefillOf(swapped, { 1: 0, 0: 1, 2: 3 }, {}, NONE)).toEqual({ A: ONE_STOP, B: NO_STOP });
  });

  it('2: prefill: one neighbour only (the best row stops none) → B is the one-stop; no neighbour → B stays empty', () => {
    const noStopBest = rowsOf([NO_STOP, TWO_STOPS, ONE_STOP]);
    expect(prefillOf(noStopBest, { 0: 0, 2: 1, 1: 2 }, {}, NONE)).toEqual({ A: NO_STOP, B: ONE_STOP });
    const alone = rowsOf([ONE_STOP, ONE_STOP_LATER, THREE_STOPS]);
    expect(prefillOf(alone, { 1: 0, 3: 2 }, {}, NONE)).toEqual({ A: ONE_STOP });
  });

  it('2: prefill: A saved → only B prefilled; A and B saved → nothing', () => {
    // the saved A has the best row's stop count (one)
    expect(prefillOf(rows, bestPerStops, { A: SAVED_A }, NONE)).toEqual({ B: TWO_STOPS });
    expect(prefillOf(rows, bestPerStops, { A: SAVED_A, B: SAVED_B }, NONE)).toEqual({});
    // B saved alone → only A
    expect(prefillOf(rows, bestPerStops, { B: SAVED_B }, NONE)).toEqual({ A: ONE_STOP });
    // other slots saved change nothing
    expect(prefillOf(rows, bestPerStops, { C: SAVED_B, G1: SAVED_A }, NONE)).toEqual({ A: ONE_STOP, B: TWO_STOPS });
  });

  it('2: prefill: a saved slot whose row is infeasible is prefilled as an empty one', () => {
    expect(prefillOf(rows, bestPerStops, { A: SAVED_A, B: SAVED_B }, new Set(['A'] as const))).toEqual({ A: ONE_STOP });
    expect(prefillOf(rows, bestPerStops, { A: SAVED_A, B: SAVED_B }, new Set(['A', 'B'] as const))).toEqual({ A: ONE_STOP, B: TWO_STOPS });
  });

  it('2: prefill: no rows → nothing', () => {
    expect(prefillOf([], {}, {}, NONE)).toEqual({});
  });

  it('2: prefill: pure: the rows are not changed', () => {
    const before = JSON.stringify(rows);
    prefillOf(rows, bestPerStops, {}, NONE);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
