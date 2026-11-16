// `gaps`' from-scratch budget (SP4.3c Task 25w, ruling R66): on the long race (`test-support/builders`, 70 laps,
// 20 cars), `init` + `output` on every frame of lap 70, where the projection is largest, without the read-counting proxy,
// takes under TARGET_MS in all. Before Task 25w (crossings scanned through holey arrays, a read-back after each folded
// crossing) it took MEASURED_BEFORE_MS on the test worker's machine (load ≈ 8); the target is at most 50 % of it. Each pass counts
// its best of several warm passes, so machine load cannot flake it (docs/testing.md 6). The timer is in this test only.
// The answers are the other gaps tests' (behaviour, property, current crossings, join, restart, gapper window); the
// counted reads are `gaps.work.test.ts`'.
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';

const PASSES = 5;
/** The time of `init` + `output` over every frame of lap 70 before Task 25w (best of PASSES). */
const MEASURED_BEFORE_MS = 1140;
/** At most 50 % of MEASURED_BEFORE_MS. */
const TARGET_MS = 570;

describe('gaps budget', () => {
  it(`budget: init + output on every frame of lap 70 of the long race under ${TARGET_MS} ms`, () => {
    const race = longRace();
    const views = race.framesOfLap(70).map((frame) => race.viewAt(frame));
    expect(views.length).toBeGreaterThan(0);
    expect(views[0]!.history.crossings.length).toBeGreaterThan(60_000);
    const pass = (): unknown[] => views.map((view) => gapsCalculator.output(gapsCalculator.init(view), view));
    const expected = pass(); // warm
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      const outputs = pass();
      best = Math.min(best, performance.now() - start);
      expect(outputs.length).toBe(expected.length);
    }
    console.info(`[gaps budget] ${views.length} frames: ${best.toFixed(1)} ms (before ${MEASURED_BEFORE_MS} ms, target ${TARGET_MS} ms)`);
    expect(best).toBeLessThan(TARGET_MS);
  });
});
