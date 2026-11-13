// `sc-call`'s budget (SP4.3b spec §9.3, §11.1, §11.2; plan SP4.3b2 Task 9 row 9, Global Constraints "caps are counts,
// never clocks"): on the long-race builder (70 laps, 20 cars) at lap 1 (the first frame the starting point is known:
// the leader has completed lap 1), the job's run at `maxScenarioPolicies` 240 within 500 ms per our car, its one DP
// solve per car included, single thread. The cap is a count (C2): a miss lowers the count, never raises the budget.
// Best of warm passes (docs/testing.md). `rejoin`'s output is passed explicitly (`./support.ts`).
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { SC_CALL_CONFIG, SC_CALL_JOB } from '../../src/sc-call/index.ts';
import { run } from '../../src/sc-call/job.ts';
import { callOf, OURS, rowOf, scViewAt } from './support.ts';

const PER_CAR_MS = 500;

describe('sc-call budget', () => {
  // row 9
  it('budget: maxScenarioPolicies 240 under 500 ms per car at lap 1, one DP solve per car included', () => {
    const cap = SC_CALL_CONFIG.defaults.maxScenarioPolicies;
    expect(cap).toBe(240);
    const view = scViewAt(longRace(), 2, { frameOfLap: 0, scConfig: { maxScenarioPolicies: cap } });
    const input = structuredClone(SC_CALL_JOB.prepare(view));

    let best = Infinity;
    let out: ReturnType<typeof run> | undefined;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      out = run(structuredClone(input), createRng(7));
      // the first pass warms
      if (k > 0) best = Math.min(best, performance.now() - t0);
    }
    for (const car of OURS) {
      const call = callOf(out!, car);
      for (const condition of ['sc', 'vsc'] as const) expect(rowOf(call, condition).ePosDelta.known, `car ${car} ${condition}`).toBe(true);
    }
    const perCar = best / OURS.length;
    console.info(`[sc-call budget] ${perCar.toFixed(0)} ms a car at cap ${cap} (long race, lap 1, one DP solve a car)`);
    expect(perCar).toBeLessThan(PER_CAR_MS);
  }, 120_000);
});
