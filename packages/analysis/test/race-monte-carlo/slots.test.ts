// `race-monte-carlo` with plan slots (SP4.3d spec §5.3; SP4.3d1 Task 5 rows 2 and 3; C43, C51): a slot is never
// dropped and always re-scored with the top `rescoreTop` leaders (on top of them, never pushing one out); every row's
// ΔPOS against the active plan (`diffPlan`, `sePlan`, places) is paired on the scenarios both were scored on: the
// re-scoring's for rows in the re-scored set, the search's otherwise.
//
// How these rows read the search (the test agent's decisions, Task 5 report):
// - A slot candidate is an `McCandidate` with its `slot` (`{ policy, source: 'plan' | 'game', rule: null, slot }`); the
//   active plan is `committed[car]`. Without an active plan the deltas are against slot A; without either, every
//   row's `diffPlan` and `sePlan` are `unknown('notApplicable')`, as are the reference row's own.
// - The sign: positive = good for us (the board's ΔPOS, as `sc-call`'s "stay's E[pos] minus its own"): `diffPlan` is
//   the mean over the common scenarios of the active plan's position minus the row's, `sePlan` that difference's SE
//   (`paired`, sample SD over √n).
// - `raceForecast` is replaced by a table of our car's position per candidate (its stop lap) and scenario id, as
//   `rescoring.test.ts` does: the search's scenarios have ids 1, 2, …, the re-scoring's ids from 2^30 on (search.ts's
//   `FRESH_FROM`); a candidate is re-scored when it is forecast on such a scenario. The table counts each candidate's
//   re-scoring scenarios, so the expected paired values are computed over exactly those.
//
// The candidates (stop laps): L (2) the leader; M (3) L's positions in the search (a tie, another race time: never
// merged); A (4) slot A, one place behind L in the search; D (5) three places behind: dropped; N (6, a DP plan) and B
// (10, slot B) the same noisy positions, clearly worse than L (beyond 4 SEs of the paired difference after the first
// batch). On the re-scoring's scenarios L alternates 2nd and 3rd, M is 3rd, A 4th, B 5th: it settles after one batch.
import { unknown, type ForecastResult, type Policy } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it, vi } from 'vitest';
import type * as forecast from '../../src/race-forecast/index.ts';
import { raceMonteCarlo, type McCandidate } from '../../src/race-monte-carlo/index.ts';
import { paired } from '../../src/race-monte-carlo/rank.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { candidate, carOf, mcInput, rowOf, stopAt, type Row } from './support.ts';

const OUR = 2;
const CARS = 6;
/** The first scenario id of the re-scoring (search.ts's `FRESH_FROM`). */
const FRESH = 0x40000000;

const L = stopAt(2);
const M = stopAt(3);
const A = stopAt(4);
const D = stopAt(5);
const N = stopAt(6);
const B = stopAt(10);

const lapOf = (p: Policy | undefined): number => p?.stops[0]?.lap ?? -1;

/** Our car's position in scenario `id` following the candidate whose stop lap is `lap`. */
function positionOf(lap: number, id: number): number {
  if (id >= FRESH) {
    const fresh: Record<number, number> = { 2: id % 2 === 0 ? 2 : 3, 3: 3, 4: 4, 5: 5, 6: 5, 10: 5 };
    return fresh[lap] ?? 6;
  }
  const search: Record<number, number> = { 2: 2, 3: 2, 4: 3, 5: 5, 6: id % 2 === 0 ? 2 : 4, 10: id % 2 === 0 ? 2 : 4 };
  return search[lap] ?? 6;
}

const table = vi.hoisted(() => ({ fresh: new Map<number, number[]>() }));

vi.mock('../../src/race-forecast/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof forecast>();
  return {
    ...real,
    raceForecast: (...args: Parameters<typeof real.raceForecast>): ForecastResult => {
      const [, policies, scenario] = args;
      const lap = lapOf(policies[OUR]);
      if (scenario.id >= FRESH) table.fresh.set(lap, [...(table.fresh.get(lap) ?? []), scenario.id]);
      const position = new Int8Array(CARS);
      const raceTimeMs = new Float64Array(CARS);
      position[OUR] = positionOf(lap, scenario.id);
      raceTimeMs[OUR] = 5_000_000 + 1_000 * lap + 10_000 * (position[OUR] ?? 0);
      return { position, raceTimeMs } as unknown as ForecastResult;
    },
  };
});

const START = startingPoint({ lapsTotal: 20, cars: Array.from({ length: CARS }, (_, i) => ({ gapMs: 1_500 * i })), ours: [OUR] });

/** A slot's candidate: source `game` for G1 and G2, else `plan`. */
const slotted = (policy: Policy, slot: 'A' | 'B' | 'C' | 'G1' | 'G2'): McCandidate => ({ policy, source: slot.startsWith('G') ? 'game' : 'plan', rule: null, slot });

/** Car 2's rows and the stop laps re-scored, its candidates `candidates`, its active plan `committed`. */
function searched(candidates: McCandidate[], committed: Policy | null, rescoreTop = 2): { rows: Row[]; rescored: number[] } {
  table.fresh.clear();
  const input = mcInput(START, { [OUR]: candidates }, { committed: { [OUR]: committed }, config: { n0: 40, zDrop: 2.8, rescoreTop, maxScenarioPolicies: 5_000 } });
  const rows = carOf(raceMonteCarlo(input, createRng(5), 5_000), OUR).rows;
  return { rows, rescored: [...table.fresh.keys()].sort((a, b) => a - b) };
}

/** The positions of the candidate of stop lap `lap` on the scenarios `ids`. */
const positionsOn = (lap: number, ids: readonly number[]): Float64Array => Float64Array.from(ids.map((id) => positionOf(lap, id)));

/** The re-scoring's scenario ids of the candidate of stop lap `lap`. */
const freshIds = (lap: number): number[] => table.fresh.get(lap) ?? [];

/** The active plan's paired ΔPOS against the row of stop lap `lap` over `ids`: positive = the row finishes ahead. */
const expectedDelta = (planLap: number, lap: number, ids: readonly number[]) => paired(positionsOn(lap, ids), positionsOn(planLap, ids));

const NOT_APPLICABLE = unknown('notApplicable');

describe('race-monte-carlo: plan slots', () => {
  // row 2
  it('never dropped: a slot 4 SEs worse than the leader stays, re-scored', () => {
    // the construction: slot B's paired difference against L after the first batch lies beyond 4 SEs (and zDrop)
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const d = paired(positionsOn(lapOf(L), ids), positionsOn(lapOf(B), ids));
    expect(d.mean, 'slot B is worse than L').toBeGreaterThan(0);
    expect(d.mean, 'beyond 4 SEs').toBeGreaterThan(4 * d.se);

    const { rows, rescored } = searched([candidate(L), candidate(M), candidate(D), candidate(N), slotted(B, 'B')], null);
    // re-scored: the two leaders (rescoreTop) plus the slot on top; its twin N (no slot) and D are not
    expect(rescored).toEqual([lapOf(L), lapOf(M), lapOf(B)]);
    const b = rowOf(rows, B);
    expect(b).toMatchObject({ slot: 'B', source: 'plan' });
    // its numbers are the re-scoring's: its pmf over its fresh scenarios (5th in every one)
    expect(b.positionPmf[4]).toBe(1);
    expect(b.ePos).toBe(5);
    // every row that is no slot has no slot
    for (const r of rows.filter((r) => lapOf(r.policy) !== lapOf(B))) expect(r.slot, `stop lap ${lapOf(r.policy)}`).toBeNull();
  });

  // row 2: the slots come on top of the leaders, never pushing one out
  it('never dropped: slots are re-scored on top of the rescoreTop leaders', () => {
    const { rescored } = searched([slotted(A, 'A'), candidate(L), candidate(M), candidate(D), slotted(B, 'B')], null, 2);
    expect(rescored).toEqual([lapOf(L), lapOf(M), lapOf(A), lapOf(B)]);
  });

  // row 3
  it("deltas: the active row's diffPlan is notApplicable; a re-scored row's diffPlan is its paired mean difference on the re-scoring's scenarios, a row outside on the search's", () => {
    const { rows, rescored } = searched([slotted(A, 'A'), candidate(L), candidate(M), candidate(D)], A);
    expect(rescored, 'the active slot is re-scored with the leaders').toEqual([lapOf(L), lapOf(M), lapOf(A)]);

    const active = rowOf(rows, A);
    expect(active).toMatchObject({ committed: true, slot: 'A' });
    expect(active.diffPlan).toEqual(NOT_APPLICABLE);
    expect(active.sePlan).toEqual(NOT_APPLICABLE);

    // L and M re-scored: paired with A over the re-scoring's scenarios both ran (here the same ids)
    for (const p of [L, M]) {
      const lap = lapOf(p);
      const ids = freshIds(lap);
      expect(ids.length, `stop lap ${lap}: re-scored`).toBeGreaterThan(0);
      expect(freshIds(lapOf(A)).slice(0, ids.length), 'common re-scoring scenarios').toEqual(ids);
      const want = expectedDelta(lapOf(A), lap, ids);
      const row = rowOf(rows, p);
      expect(row.diffPlan.known, `stop lap ${lap}`).toBe(true);
      expect(row.sePlan.known, `stop lap ${lap}`).toBe(true);
      expect(row.diffPlan.known ? row.diffPlan.value : NaN, `stop lap ${lap}: diffPlan`).toBeCloseTo(want.mean, 10);
      expect(row.sePlan.known ? row.sePlan.value : NaN, `stop lap ${lap}: sePlan`).toBeCloseTo(want.se, 10);
      // over common scenarios the paired mean is the difference of the two rows' E[position]
      expect(row.diffPlan.known ? row.diffPlan.value : NaN).toBeCloseTo(active.ePos - row.ePos, 10);
    }
    // the constructed values: A 4th against L's 2nd or 3rd, M's 3rd
    expect(rowOf(rows, L).diffPlan).toMatchObject({ known: true, value: 1.5 });
    expect(rowOf(rows, M).diffPlan).toMatchObject({ known: true, value: 1 });

    // D, not re-scored: paired with A over the search's scenarios (A 3rd, D 5th: two places worse, no spread)
    const d = rowOf(rows, D);
    expect(d.diffPlan).toMatchObject({ known: true, value: -2 });
    expect(d.sePlan).toMatchObject({ known: true, value: 0 });
  });

  // row 3: the reference without an active plan
  it('deltas: without an active plan against slot A; without either, notApplicable', () => {
    const withA = searched([candidate(L), candidate(M), slotted(A, 'A')], null);
    expect(rowOf(withA.rows, A).diffPlan).toEqual(NOT_APPLICABLE);
    expect(rowOf(withA.rows, A).committed).toBe(false);
    const ids = freshIds(lapOf(L));
    const want = expectedDelta(lapOf(A), lapOf(L), ids);
    const l = rowOf(withA.rows, L);
    expect(l.diffPlan.known ? l.diffPlan.value : NaN).toBeCloseTo(want.mean, 10);
    expect(l.sePlan.known ? l.sePlan.value : NaN).toBeCloseTo(want.se, 10);

    // only slot B, nothing active: no reference
    const withoutA = searched([candidate(L), candidate(M), slotted(B, 'B')], null);
    for (const r of withoutA.rows) {
      expect(r.diffPlan, `stop lap ${lapOf(r.policy)}`).toEqual(NOT_APPLICABLE);
      expect(r.sePlan, `stop lap ${lapOf(r.policy)}`).toEqual(NOT_APPLICABLE);
    }
  });
});
