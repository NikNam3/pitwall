// `forecast-score`'s budget (SP4.3a spec 10; plan Task 19 row 12): one job run at the end of lap 70 of the long-race
// builder (70 laps, 20 cars), where it scores the most cases (about 280 plain forecasts and every experiment), under
// 0.5 s. The job runs in a worker (C51), off the frame path, so ruling R25 (per frame over a lap) does not apply: the
// time of one run on the input as the worker receives it, best of a few warm passes (docs/testing.md 6).
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/forecast-score/job.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { inputAt } from './support.ts';

const PASSES = 3;
const TARGET_MS = 500;

describe('forecast-score budget', () => {
  it(`budget: the job at lap 70 of the long race under ${TARGET_MS / 1_000} s`, () => {
    const race = longRace();
    const input = inputAt(race, race.lastFrame);
    run(input, createRng(0)); // warm
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      run(input, createRng(0));
      best = Math.min(best, performance.now() - start);
    }
    console.info(`[forecast-score budget] ${best.toFixed(1)} ms for one run at lap 70, target ${TARGET_MS} ms`);
    expect(best).toBeLessThan(TARGET_MS);
  });
});
