// `strategy-dp`'s budget (SP4.3b spec §6, §11.2; plan 4.3b1 Task 18 row 10; SP4.3c spec §7, plan Task 19 row 7): one
// car's solve from lap 1 of the long race (70 laps, as the long-race builder), up to 3 stops, the hazard of a track table
// and every dry compound with sets left, under 300 ms per weather world: one world under 300 ms, two (the default K = 2)
// under 600 ms. The best of several passes counts, after warm passes, so machine load cannot flake it (docs/testing.md).
import { describe, expect, it } from 'vitest';
import { bestWith, solveDp, solveWorld, type DpFirst, type DpInput, type DpUnder } from '../../src/strategy-dp/index.ts';
import { HAZARD } from '../race-hazard/support.ts';
import { chancesFrom, dpInput, LAP, type DpSpec } from './support.ts';

const LAPS = 70;
const WARM = 2;
const PASSES = 5;

const traffic = (k: number): number[] => Array.from({ length: LAPS }, (_, i) => 250 * ((i + k) % 5));

const spec: DpSpec = {
  totalLaps: LAPS,
  lap: {
    ...LAP,
    compoundOffsetMs: { soft: -400, medium: 0, hard: 300, inter: 1_500, wet: 3_000 },
    fuelMsPerKg: 30,
    convexMsPerPct2: 0.5,
    coldTyreMs: [800, 300],
    neutralised: { sc: { paceFactor: 1.4, wearFactor: 0.3, fuelFactor: 0.5 }, vsc: { paceFactor: 1.3, wearFactor: 0.4, fuelFactor: 0.6 } },
    wetnessMsPerMs: { slick: 0.3, inter: 0, wet: 0 },
  },
  car: { compound: 'soft', fuelKg: 100, degMsPerLap: { soft: 30, medium: 22, hard: 15 }, lapsToLimit: { soft: 20, medium: 30, hard: 45 } },
  sets: { soft: 2, medium: 2, hard: 2 },
  owesSecondCompound: true,
  scByLap: chancesFrom(HAZARD, 1, LAPS, 'sc'),
  vscByLap: chancesFrom(HAZARD, 1, LAPS, 'vsc'),
  scDur: HAZARD.durationLaps.sc,
  vscDur: HAZARD.durationLaps.vsc,
};

/** One world, dry. */
const oneWorld = dpInput({ ...spec, trafficMsByLap: traffic(0) });
/** Two worlds: a dry one and one where it rains from lap 30 (the default K = 2 of a forecast with rain). */
const twoWorlds = dpInput({
  ...spec,
  worlds: [
    { u: 0.25, weight: 0.5, trafficMsByLap: traffic(0), wetnessByLap: Array.from({ length: LAPS }, (_, i) => (i >= 29 ? Math.min(16_000, 8_500 * (i - 28)) : 0)) },
    { u: 0.75, weight: 0.5, trafficMsByLap: traffic(2) },
  ],
});

/** The best of `PASSES` timed passes of `run`, after `WARM` warm ones. */
function bestOf(run: () => void): number {
  const pass = (): number => {
    const t0 = performance.now();
    run();
    return performance.now() - t0;
  };
  for (let k = 0; k < WARM; k++) pass();
  let best = Infinity;
  for (let k = 0; k < PASSES; k++) best = Math.min(best, pass());
  return best;
}

describe('strategy-dp budget', () => {
  // row 7: per car and world
  it('budget: under 300 ms per car at lap 1, ≤ 3 stops, one world', () => {
    const best = bestOf(() => solveDp(oneWorld));
    console.info(`[strategy-dp budget] from lap 1, one world: best ${best.toFixed(1)} ms a car`);
    expect(best).toBeLessThan(300);
  });

  it('budget: under 600 ms per car at lap 1, ≤ 3 stops, two worlds (300 ms per world)', () => {
    expect(twoWorlds.worlds).toHaveLength(2);
    const best = bestOf(() => solveDp(twoWorlds));
    console.info(`[strategy-dp budget] from lap 1, two worlds: best ${best.toFixed(1)} ms a car`);
    expect(best).toBeLessThan(600);
  });

  // SP4.3b2 Task 5 row 8: a call's one solve per car plus its queries of the solved table (spec §11.2)
  it('budget: solveWorld once plus 100 bestWith calls within 300 ms on the long-race builder at lap 1', () => {
    const sc: DpUnder = { condition: 'sc', remaining: Float64Array.from(HAZARD.durationLaps.sc) };
    const vsc: DpUnder = { condition: 'vsc', remaining: Float64Array.from(HAZARD.durationLaps.vsc) };
    const queries: [DpFirst, DpUnder | undefined][] = [];
    for (let stopLap = 1; queries.length < 90; stopLap++) {
      for (const compound of ['soft', 'medium', 'hard'] as const) queries.push([{ stopLap, compound }, undefined]);
    }
    for (let k = 0; k < 4; k++) queries.push([{ stopLap: 1, compound: 'best' }, k % 2 === 0 ? sc : vsc]);
    for (let k = 0; k < 6; k++) queries.push([{ noStopThrough: 1 + 10 * k }, k % 3 === 0 ? sc : undefined]);
    expect(queries).toHaveLength(100);
    const input: DpInput = twoWorlds;
    const best = bestOf(() => {
      const solution = solveWorld(input, 0);
      for (const [first, under] of queries) bestWith(solution, first, under);
    });
    console.info(`[strategy-dp budget] solveWorld + 100 bestWith from lap 1: best ${best.toFixed(1)} ms a car`);
    expect(best).toBeLessThan(300);
  });
});
