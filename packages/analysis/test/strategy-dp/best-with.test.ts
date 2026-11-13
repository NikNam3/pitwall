// `bestWith` (SP4.3b2 Task 5, spec §6, §9): a query of one `solveDp` solve, never a new solve: the best plan to the flag
// whose first stop is forced (at `stopLap` onto a compound, `'best'`: the DP picks; or no stop through `noStopThrough`),
// optionally from the state "that neutralisation out at the start lap" (`under`). `support.ts` states how these tests read
// `DpInput` and `DpPlan`; the deterministic rows compare with an enumeration of every stop list (no hazard).
import type { NoiseCompound } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { bestWith, dpResult, solveDp, strategyDp, type DpInput, type DpPlan, type DpUnder } from '../../src/strategy-dp/index.ts';
import { dpInput, everyStopList, LAP, meetsRule, raceTimeMs } from './support.ts';

const DIGITS = 3;

type Stop = { lap: number; compound: NoiseCompound };

/** A deterministic race with a real trade-off: wear and degradation make a stop pay, the rule owes a second compound. */
const deterministic = (over: Parameters<typeof dpInput>[0] = {}): DpInput =>
  dpInput({
    totalLaps: 10,
    lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: 0, wet: 0 }, convexMsPerPct2: 2 },
    car: { compound: 'medium', degMsPerLap: 120 },
    sets: { soft: 1, medium: 1, hard: 1 },
    owesSecondCompound: true,
    ...over,
  });

/** The best stop list by enumeration whose first stop passes `first`, with its race time; `null` where none meets the rule. */
function bestEnumerated(input: DpInput, first: (stops: readonly Stop[]) => boolean, neutralOf?: (lap: number) => 'none' | 'sc' | 'vsc'): { stops: Stop[]; ms: number } | null {
  let best: { stops: Stop[]; ms: number } | null = null;
  for (const stops of everyStopList(input)) {
    if (!first(stops) || !meetsRule(input, stops)) continue;
    const ms = raceTimeMs(input, stops, neutralOf);
    if (best === null || ms < best.ms) best = { stops, ms };
  }
  return best;
}

const expectSamePlan = (actual: DpPlan | null, expected: DpPlan | null): void => {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expect(actual!.stops).toEqual(expected!.stops);
  expect(actual!.expectedMs).toBeCloseTo(expected!.expectedMs, DIGITS);
};

describe('strategy-dp bestWith', () => {
  // row 1
  it("bestWith(stopLap = the best plan's first stop, 'best') equals dpResult's best plan", () => {
    const input = deterministic();
    const solution = solveDp(input);
    const best = dpResult(solution).plans[0]!;
    expect(best.stops.length).toBeGreaterThan(0);
    expectSamePlan(bestWith(solution, { stopLap: best.stops[0]!.lap, compound: 'best' }), best);
  });

  // row 2
  it('a forced stop onto the only compound that keeps the rule keeps it in the continuation', () => {
    // on mediums, owing a second dry compound, with one hard set and two medium sets: hard is the only compound that
    // keeps the rule; a forced stop onto it uses its one set, so the continuation may stop only onto mediums
    const input = deterministic({ sets: { medium: 2, hard: 1 } });
    const solution = solveDp(input);
    for (const stopLap of [2, 5, 8]) {
      const plan = bestWith(solution, { stopLap, compound: 'hard' });
      expect(plan).not.toBeNull();
      expect(plan!.stops[0]).toEqual({ lap: stopLap, compound: 'hard' });
      expect(meetsRule(input, plan!.stops)).toBe(true);
      expect(plan!.stops.filter((s) => s.compound === 'hard')).toHaveLength(1);
      const enumerated = bestEnumerated(input, (stops) => stops[0]?.lap === stopLap && stops[0]?.compound === 'hard')!;
      expect(plan!.stops).toEqual(enumerated.stops);
      expect(plan!.expectedMs).toBeCloseTo(enumerated.ms, DIGITS);
    }
    // forced onto mediums (the rule not kept by the first stop): the continuation still owes the hard and fits it
    const onMedium = bestWith(solution, { stopLap: 3, compound: 'medium' });
    expect(onMedium).not.toBeNull();
    expect(onMedium!.stops[0]).toEqual({ lap: 3, compound: 'medium' });
    expect(onMedium!.stops.slice(1).some((s) => s.compound === 'hard')).toBe(true);
  });

  // row 3
  it('no set of the compound → null', () => {
    const solution = solveDp(deterministic({ sets: { medium: 1, hard: 1 } }));
    expect(bestWith(solution, { stopLap: 4, compound: 'soft' })).toBeNull();
    expect(bestWith(solution, { stopLap: 4, compound: 'inter' })).toBeNull();
  });

  // row 4
  it('noStopThrough the last lap with a second compound owed → null', () => {
    const input = deterministic();
    const solution = solveDp(input);
    expect(bestWith(solution, { noStopThrough: input.totalLaps })).toBeNull();
    // the same query without the rule owed is the no-stop plan
    const free = deterministic({ owesSecondCompound: false });
    const plan = bestWith(solveDp(free), { noStopThrough: free.totalLaps });
    expect(plan).not.toBeNull();
    expect(plan!.stops).toEqual([]);
    expect(plan!.expectedMs).toBeCloseTo(raceTimeMs(free, []), DIGITS);
  });

  // row 5
  it('under an SC (input.active or under), boxing now costs the SC loss', () => {
    const input = deterministic();
    const sc: DpUnder = { condition: 'sc', remaining: Float64Array.from([1]) };
    const scAtStart = (lap: number): 'none' | 'sc' => (lap === input.fromLap ? 'sc' : 'none');
    const boxNow = (stops: readonly Stop[]): boolean => stops[0]?.lap === input.fromLap && stops[0]?.compound === 'hard';
    const enumerated = bestEnumerated(input, boxNow, scAtStart)!;
    const green = bestEnumerated(input, boxNow)!;

    const viaUnder = bestWith(solveDp(input), { stopLap: input.fromLap, compound: 'hard' }, sc);
    const viaActive = bestWith(solveDp({ ...input, active: sc }), { stopLap: input.fromLap, compound: 'hard' });
    for (const plan of [viaUnder, viaActive]) {
      expect(plan).not.toBeNull();
      expect(plan!.stops).toEqual(enumerated.stops);
      expect(plan!.expectedMs).toBeCloseTo(enumerated.ms, DIGITS);
    }
    // the same stop under green pays the green loss
    const greenPlan = bestWith(solveDp(input), { stopLap: input.fromLap, compound: 'hard' })!;
    expect(greenPlan.expectedMs).toBeCloseTo(green.ms, DIGITS);
  });

  // row 6
  it('strategyDp(input) equals dpResult(solveDp(input))', () => {
    const input = deterministic({
      scByLap: [0, 0.1, 0.1, 0.2, 0.1],
      vscByLap: [0, 0.05, 0.1, 0.05],
      scDur: [0.5, 0.5],
      vscDur: [1],
    });
    expect(strategyDp(input)).toEqual(dpResult(solveDp(input)));
  });

  // row 7
  it('bestWith with under equals the plan of a fresh solve with input.active set to that neutralisation', () => {
    const input = deterministic({
      totalLaps: 8,
      scByLap: [0, 0.1, 0.15, 0.2, 0.1, 0.05],
      vscByLap: [0, 0.05, 0.1, 0.05],
      scDur: [0.4, 0.6],
      vscDur: [0.7, 0.3],
    });
    const solution = solveDp(input);
    for (const under of [
      { condition: 'sc', remaining: Float64Array.from([0.3, 0.5, 0.2]) },
      { condition: 'vsc', remaining: Float64Array.from([0.6, 0.4]) },
    ] satisfies DpUnder[]) {
      const freshSolution = solveDp({ ...input, active: under });
      const fresh = dpResult(freshSolution);
      expectSamePlan(bestWith(solution, { stopLap: input.fromLap, compound: 'best' }, under), fresh.boxNow);
      expectSamePlan(bestWith(solution, { noStopThrough: input.fromLap }, under), fresh.stayOut);
      for (const first of [
        { stopLap: input.fromLap, compound: 'hard' },
        { stopLap: 3, compound: 'soft' },
        { stopLap: 5, compound: 'best' },
        { noStopThrough: 2 },
      ] satisfies Parameters<typeof bestWith>[1][]) {
        expectSamePlan(bestWith(solution, first, under), bestWith(freshSolution, first));
      }
    }
  });
});
