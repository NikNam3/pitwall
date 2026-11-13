// `strategy-dp`'s budget (SP4.3b spec §6, §11.2; plan 4.3b1 Task 18 row 10): one car's solve from lap 1 of the long race
// (70 laps, as the long-race builder), up to 3 stops, the hazard of a track table and every dry compound with sets left,
// under 300 ms. The best of several passes counts, after warm passes, so machine load cannot flake it (docs/testing.md).
import { describe, expect, it } from 'vitest';
import { bestWith, solveDp, strategyDp, type DpFirst, type DpUnder } from '../../src/strategy-dp/index.ts';
import { HAZARD } from '../race-hazard/support.ts';
import { chancesFrom, dpInput, LAP } from './support.ts';

const LAPS = 70;
const WARM = 2;
const PASSES = 5;

const input = dpInput({
  totalLaps: LAPS,
  lap: {
    ...LAP,
    compoundOffsetMs: { soft: -400, medium: 0, hard: 300, inter: 0, wet: 0 },
    fuelMsPerKg: 30,
    convexMsPerPct2: 0.5,
    coldTyreMs: [800, 300],
    neutralised: { sc: { paceFactor: 1.4, wearFactor: 0.3, fuelFactor: 0.5 }, vsc: { paceFactor: 1.3, wearFactor: 0.4, fuelFactor: 0.6 } },
  },
  car: { compound: 'soft', fuelKg: 100, degMsPerLap: 30 },
  sets: { soft: 2, medium: 2, hard: 2 },
  owesSecondCompound: true,
  scByLap: chancesFrom(HAZARD, 1, LAPS, 'sc'),
  vscByLap: chancesFrom(HAZARD, 1, LAPS, 'vsc'),
  scDur: HAZARD.durationLaps.sc,
  vscDur: HAZARD.durationLaps.vsc,
  trafficMsByLap: Array.from({ length: LAPS }, (_, i) => 250 * (i % 5)),
});

describe('strategy-dp budget', () => {
  // row 10
  it('budget: under 300 ms per car at lap 1, ≤ 3 stops', () => {
    const pass = (): number => {
      const t0 = performance.now();
      strategyDp(input);
      return performance.now() - t0;
    };
    for (let k = 0; k < WARM; k++) pass();
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) best = Math.min(best, pass());
    console.info(`[strategy-dp budget] from lap 1: best ${best.toFixed(1)} ms a car`);
    expect(best).toBeLessThan(300);
  });

  // SP4.3b2 Task 5 row 8: a call's one solve per car plus its queries of the solved table (spec §11.2)
  it('budget: solveDp once plus 100 bestWith calls within 300 ms on the long-race builder at lap 1', () => {
    const sc: DpUnder = { condition: 'sc', remaining: Float64Array.from(HAZARD.durationLaps.sc) };
    const vsc: DpUnder = { condition: 'vsc', remaining: Float64Array.from(HAZARD.durationLaps.vsc) };
    const queries: [DpFirst, DpUnder | undefined][] = [];
    for (let stopLap = 1; queries.length < 90; stopLap++) {
      for (const compound of ['soft', 'medium', 'hard'] as const) queries.push([{ stopLap, compound }, undefined]);
    }
    for (let k = 0; k < 4; k++) queries.push([{ stopLap: 1, compound: 'best' }, k % 2 === 0 ? sc : vsc]);
    for (let k = 0; k < 6; k++) queries.push([{ noStopThrough: 1 + 10 * k }, k % 3 === 0 ? sc : undefined]);
    expect(queries).toHaveLength(100);
    const pass = (): number => {
      const t0 = performance.now();
      const solution = solveDp(input);
      for (const [first, under] of queries) bestWith(solution, first, under);
      return performance.now() - t0;
    };
    for (let k = 0; k < WARM; k++) pass();
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) best = Math.min(best, pass());
    console.info(`[strategy-dp budget] solveDp + 100 bestWith from lap 1: best ${best.toFixed(1)} ms a car`);
    expect(best).toBeLessThan(300);
  });
});
