// `pit-sweep`'s budget (SP4.3b spec §9.2, §11.2; plan 4.3b2 Task 8 row 11, Global Constraints "caps are counts"): on the
// long-race builder (70 laps, 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed
// lap 1), one car's run over one compound at the config's `maxScenarioPolicies` (1,000), its one DP solve included,
// under 1.5 s. The cap is a count (C2): a miss lowers the count, never raises the budget. Best of warm passes
// (docs/testing.md). One car of ours (no teammate), so the run's time is that car's.
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { PIT_SWEEP_CONFIG, PIT_SWEEP_JOB } from '../../src/pit-sweep/index.ts';
import { run } from '../../src/pit-sweep/job.ts';
import { PLAYER, sweepViewAt } from './support.ts';

const JOB_MS = 1_500;

describe('pit-sweep budget', () => {
  // row 11
  it('budget: one compound with maxScenarioPolicies 1000 under 1.5 s per car at lap 1, one DP solve per car included', () => {
    const cap = PIT_SWEEP_CONFIG.defaults.maxScenarioPolicies;
    expect(cap).toBe(1_000);
    const view = sweepViewAt(longRace(), 2, {
      frameOfLap: 0,
      teammate: null,
      window: { compounds: ['hard'], latestIn: null },
      sweepConfig: { maxScenarioPolicies: cap },
    });
    const input = PIT_SWEEP_JOB.prepare(view);
    let best = Infinity;
    let out: ReturnType<typeof run> | undefined;
    for (let k = 0; k < 4; k++) {
      const copy = structuredClone(input);
      const t0 = performance.now();
      out = run(copy, createRng(7));
      // the first pass warms
      if (k > 0) best = Math.min(best, performance.now() - t0);
    }
    const table = out?.[PLAYER]?.byCompound.hard;
    expect(table?.known, 'the hard table').toBe(true);
    const rows = table!.known ? table!.value.rows.length : 0;
    expect(rows).toBeGreaterThan(10);
    console.info(`[pit-sweep budget] car ${PLAYER}, one compound, ${rows} rows at cap ${cap}: ${best.toFixed(0)} ms (long race, lap 1)`);
    expect(best).toBeLessThan(JOB_MS);
  }, 120_000);
});
