// `forecast-score`'s budget (SP4.3a spec 10; plan Task 19 row 12; ported in SP4.3b1 Task 22 row 4, spec §8.4, §11):
// one job run at the end of lap 70 of the long-race builder (70 laps, 20 cars), where it scores the most cases (about
// 280 plain forecasts, every experiment and the CRPS of 14 predict laps × 200 scenarios), under 1.5 s (4.3a's 0.5 s
// plus the CRPS share ≤ 1.0 s). A miss lowers `crpsScenarios` or raises `crpsEveryLaps`, never the budget. The job runs
// in a worker (C51), off the frame path, so ruling R25 (per frame over a lap) does not apply: the time of one run on
// the input as the worker receives it, best of a few warm passes (docs/testing.md 6).
import type { ForecastScoreReport } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/forecast-score/job.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { inputAt } from './support.ts';

const PASSES = 3;
const TARGET_MS = 1_500;

/** The CRPS cases of a report (`forecasts[].crps`, a domain field the supervisor adds, C78). */
const crpsCases = (report: ForecastScoreReport): number =>
  report.forecasts.reduce((n, f) => {
    const crps = (f as unknown as { crps?: { ai: { n: number }; human: { n: number } } }).crps;
    return n + (crps?.ai.n ?? 0) + (crps?.human.n ?? 0);
  }, 0);

describe('forecast-score budget', () => {
  it(`budget: the job at lap 70 of the long-race builder under ${TARGET_MS / 1_000} s`, () => {
    const race = longRace();
    const input = inputAt(race, race.lastFrame);
    // the run measured scores the CRPS too
    expect(crpsCases(run(input, createRng(0)))).toBeGreaterThan(0); // warm
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      run(input, createRng(0));
      best = Math.min(best, performance.now() - start);
    }
    console.info(`[forecast-score budget] ${best.toFixed(1)} ms for one run at lap 70, target ${TARGET_MS} ms`);
    expect(best).toBeLessThan(TARGET_MS);
  }, 30_000); // the test's own time (long-race build, warm run, passes), not the measured target (as strategy.budget's)
});
