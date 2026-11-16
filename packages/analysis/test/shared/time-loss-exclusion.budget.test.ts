// The time-loss exclusion's budget (SP4.3c Task 25s, ruling R62): on the long race (`test-support/builders`, 70 laps,
// 20 cars) at the end of the leader's lap 70, where the projection is largest, one `timeLossExcludedOf` build plus a
// check of every car's every mini-sector (from its start crossing's frame to its end crossing's, as `damage` and
// `incidents` check them on a from-scratch `init`) takes under TARGET_MS. Before Task 25s (two `spansOverlapping`
// queries per check) it took MEASURED_BEFORE_MS on the supervisor's machine; the target is at most 25 % of it. Each pass counts
// its best of several warm passes, so machine load cannot flake it (docs/testing.md 6). The timer is in this test only.
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { timeLossExcludedOf } from '../../src/shared/neutralised.ts';

const PASSES = 7;
/** The time of one build and every check before Task 25s (best of PASSES, quiet machine). */
const MEASURED_BEFORE_MS = 47;
/** At most 25 % of MEASURED_BEFORE_MS. */
const TARGET_MS = 11;

describe('time-loss exclusion budget', () => {
  it(`budget: one build and every (car, lap, mini-sector) check at lap 70 of the long race under ${TARGET_MS} ms`, () => {
    const race = longRace();
    const frames = race.framesOfLap(70);
    const view = race.viewAt(frames[frames.length - 1]!);
    const checks: Array<{ car: (typeof view.history.crossings)[number]['carId']; from: number; to: number }> = [];
    const last = new Map<number, number>();
    for (const c of view.history.crossings) {
      const from = last.get(c.carId);
      if (from !== undefined) checks.push({ car: c.carId, from, to: c.frame });
      last.set(c.carId, c.frame);
    }
    expect(checks.length).toBeGreaterThan(60_000);
    const pass = (): number => {
      let excluded = 0;
      const isExcluded = timeLossExcludedOf(view);
      for (const { car, from, to } of checks) if (isExcluded(car, from, to)) excluded++;
      return excluded;
    };
    const expected = pass(); // warm
    expect(expected).toBeGreaterThan(0);
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      const excluded = pass();
      best = Math.min(best, performance.now() - start);
      expect(excluded).toBe(expected);
    }
    console.info(`[time-loss exclusion budget] ${checks.length} checks: ${best.toFixed(1)} ms (before ${MEASURED_BEFORE_MS} ms, target ${TARGET_MS} ms)`);
    expect(best).toBeLessThan(TARGET_MS);
  });
});
