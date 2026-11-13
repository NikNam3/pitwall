// `strategy`'s budget (SP4.3b spec §8.1, §11.2, S26; plan 4.3b1 Task 20 row 12): on the long-race builder (70 laps,
// 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed lap 1), `prepare` under
// 20 ms and the job, both our cars at the config's `maxScenarioPolicies`, within 5 s single thread. The cap is a count
// (C2): a miss lowers the count, never raises the budget. Best of warm passes (docs/testing.md).
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { prepareStrategy, runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { OURS, viewAt } from './support.ts';

const PREPARE_MS = 20;
const JOB_MS = 5_000;

describe('strategy budget', () => {
  // row 12
  it('budget: prepare under 20 ms; the job with maxScenarioPolicies 6,000 finishes within 5 s single thread at lap 1 of the long race', () => {
    const cap = STRATEGY_CONFIG.defaults.maxScenarioPolicies;
    const view = viewAt(longRace(), 2, { frameOfLap: 0, config: { maxScenarioPolicies: cap } });

    let prepareBest = Infinity;
    for (let k = 0; k < 3; k++) prepareStrategy(view);
    for (let k = 0; k < 10; k++) {
      const t0 = performance.now();
      prepareStrategy(view);
      prepareBest = Math.min(prepareBest, performance.now() - t0);
    }

    const input = structuredClone(prepareStrategy(view));
    expect(input.start.known).toBe(true);
    let jobBest = Infinity;
    let out: ReturnType<typeof runStrategy> | undefined;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      out = runStrategy(structuredClone(input), createRng(7));
      // the first pass warms
      if (k > 0) jobBest = Math.min(jobBest, performance.now() - t0);
    }
    for (const car of OURS) expect(out?.[car]?.known, `car ${car}`).toBe(true);
    console.info(`[strategy budget] prepare ${prepareBest.toFixed(1)} ms, job ${jobBest.toFixed(0)} ms at cap ${cap} (long race, lap 1)`);
    expect(prepareBest).toBeLessThan(PREPARE_MS);
    expect(jobBest).toBeLessThan(JOB_MS);
  }, 60_000);
});
