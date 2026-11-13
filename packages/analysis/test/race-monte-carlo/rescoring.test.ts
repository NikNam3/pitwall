// `race-monte-carlo`'s re-scoring choice (SP4.3b spec §7.3 step 5; SP4.3b Task 28, Q7 A). The re-scoring top is the
// survivors of the search in rank order first, then the dropped candidates by their paired difference against the
// leader over their shared scenarios (`paired`), never by their own means over unequal counts.
//
// How these rows read the search (the test agent's decisions, Task 28 report): `raceForecast` is replaced by a table
// of our car's outcome per candidate and scenario id (`scenario.id`), so which candidates survive and which are dropped
// is known by hand. The search's scenarios have ids 1, 2, …; the re-scoring's fresh ones ids from 2^30 on (search.ts's
// `FRESH_FROM`): a candidate is re-scored when it is forecast on such a scenario. The first 40 scenarios (the first
// batch, n0) are easy (our car 2nd in every candidate's base), the rest hard (4th): a candidate dropped after the first
// batch keeps a stale own mean below the survivors' means over more scenarios (the diagnosis of 2026-11-13).
// - L (stop lap 2): the leader. S (lap 3, row 1 only): L's positions, another race time (so never merged): a tie.
// - O (lap 4): L plus a cycle of differences (mean 0.2 places): open after the first batch, dropped at 160 scenarios
//   (zDrop 2.8), so the search runs L (and S) on to 160.
// - D1–D5 (laps 5–9): L plus one place, plus one more on the first k scenarios (paired difference 1 + k/40): dropped
//   after the first batch, own means 3.025–3.125 against L's 3.5 over 160.
// - Fresh scenarios: L 2nd, every other 4th, so the re-scoring settles after its first batch.
import type { ForecastResult, Policy } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it, vi } from 'vitest';
import type * as forecast from '../../src/race-forecast/index.ts';
import { raceMonteCarlo } from '../../src/race-monte-carlo/index.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { carOf, mcInput, stopAt } from './support.ts';

const OUR = 2;
const CARS = 6;
/** The first scenario id of the re-scoring (search.ts's `FRESH_FROM`). */
const FRESH = 0x40000000;
const EASY = 40;
const CYCLE = [1, 0, 0, -1, 1];

const L = stopAt(2);
const S = stopAt(3);
const O = stopAt(4);
const D = [1, 2, 3, 4, 5].map((k) => stopAt(4 + k));

const lapOf = (p: Policy | undefined): number => p?.stops[0]?.lap ?? -1;

/** Our car's position in scenario `id` following the candidate whose stop lap is `lap`. */
function positionOf(lap: number, id: number): number {
  if (id >= FRESH) return lap === 2 ? 2 : 4;
  const base = id <= EASY ? 2 : 4;
  if (lap === 2 || lap === 3) return base;
  if (lap === 4) return base + (CYCLE[id % CYCLE.length] ?? 0);
  const k = lap - 4;
  return base + 1 + (id <= k ? 1 : 0);
}

const table = vi.hoisted(() => ({ rescored: new Set<number>() }));

vi.mock('../../src/race-forecast/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof forecast>();
  return {
    ...real,
    raceForecast: (...args: Parameters<typeof real.raceForecast>): ForecastResult => {
      const [, policies, scenario] = args;
      const lap = lapOf(policies[OUR]);
      if (scenario.id >= FRESH) table.rescored.add(lap);
      const position = new Int8Array(CARS);
      const raceTimeMs = new Float64Array(CARS);
      position[OUR] = positionOf(lap, scenario.id);
      raceTimeMs[OUR] = 5_000_000 + 1_000 * lap + 10_000 * (position[OUR] ?? 0);
      return { position, raceTimeMs } as unknown as ForecastResult;
    },
  };
});

const START = startingPoint({ lapsTotal: 20, cars: Array.from({ length: CARS }, (_, i) => ({ gapMs: 1_500 * i })), ours: [OUR] });

/** The stop laps of the candidates re-scored when car 2's candidates `candidates` are searched with `rescoreTop`. */
function rescored(candidates: Policy[], rescoreTop: number): { laps: number[]; first: number } {
  table.rescored.clear();
  const input = mcInput(START, { [OUR]: candidates }, { config: { n0: 40, zDrop: 2.8, rescoreTop, maxScenarioPolicies: 5_000 } });
  const rows = carOf(raceMonteCarlo(input, createRng(28), 5_000), OUR).rows;
  return { laps: [...table.rescored].sort((a, b) => a - b), first: lapOf(rows[0]?.policy) };
}

describe('race-monte-carlo: the re-scoring choice', () => {
  // row 1
  it('a dropped candidate never takes a re-scoring slot before a survivor', () => {
    // survivors L and S (a tie), two slots: both survivors, no dropped candidate
    const { laps } = rescored([L, S, O, ...D], 2);
    expect(laps).toEqual([lapOf(L), lapOf(S)]);
  });

  // row 2
  it('the only survivor is always re-scored', () => {
    const { laps, first } = rescored([L, O, ...D], 5);
    expect(laps).toContain(lapOf(L));
    expect(first, 'the survivor, best on the fresh scenarios, ranks first').toBe(lapOf(L));
  });

  // row 3
  it('dropped candidates fill the remaining slots by their paired difference against the leader', () => {
    // one survivor (L), three slots: then O (paired difference 0.2 over 160) and D1 (1.025 over 40), not D1–D3 by own means
    const { laps } = rescored([L, O, ...D], 3);
    expect(laps).toEqual([lapOf(L), lapOf(O), lapOf(D[0])]);
  });
});
