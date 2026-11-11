// The generator's speed budget (SP4.3a plan Task 7, P8): the default race (20 cars, 50 laps) is generated, and its last
// frame's view built, in under 200 ms. The best of the timed passes after a warm one counts, so machine load cannot flake
// it (docs/testing.md 6).
import { describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS } from './index.ts';

const PASSES = 5;
const TARGET_MS = 200;

describe('race generator budget', () => {
  it(`a 20-car, 50-lap race: the best of ${PASSES} warm passes in under ${TARGET_MS} ms`, () => {
    expect([GENERATOR_DEFAULTS.cars, GENERATOR_DEFAULTS.laps]).toEqual([20, 50]);
    /** One pass: the race generated and its final view built; the lap count keeps the work observable. */
    const pass = (seed: number): number => {
      const { race } = generateRace(GENERATOR_DEFAULTS, seed);
      return race.viewAt(race.lastFrame).history.laps.length;
    };
    const warm = pass(0);
    expect(warm).toBeGreaterThan(20 * 40);
    const times: number[] = [];
    for (let i = 1; i <= PASSES; i++) {
      const start = performance.now();
      pass(i);
      times.push(performance.now() - start);
    }
    const best = Math.min(...times);
    console.info(`[generator budget] ${times.map((t) => t.toFixed(0)).join(' ms, ')} ms (best ${best.toFixed(0)} ms, target ${TARGET_MS} ms)`);
    expect(best).toBeLessThan(TARGET_MS);
  });
});
