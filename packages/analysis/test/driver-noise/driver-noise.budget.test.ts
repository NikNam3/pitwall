// `driver-noise`'s budget (SP4.3a spec 10, plan Task 10 R5): under 0.2 ms per frame, averaged over the frames of the
// leader's lap 70 of the long-race builder (20 cars, 70 laps), where the projection is largest. Its cadence is
// `lapCompleted`: it runs on the frames that append a lap record, so the lap's cost is its runs on those frames, spread
// over a real lap's frames (ruling R25). Each run counts its best of several warm passes, so machine load cannot flake
// it (docs/testing.md 6). Its upstream outputs (`degradation`, `track-wetness`) are computed beforehand and not timed.
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { driverNoiseCalculator } from '../../src/driver-noise/calculator.ts';
import { upstreamOf } from './support.ts';

const PASSES = 25;
const TARGET_MS_PER_FRAME = 0.2;
/** A real lap's frames (about 90 s at the game's ~55 Hz): the builder holds only 20 frames per lap (ruling R25). */
const REAL_FRAMES_PER_LAP = 5_000;

describe('driver-noise budget', () => {
  it(`budget: under ${TARGET_MS_PER_FRAME} ms per frame averaged over lap 70 of the long race`, () => {
    const race = longRace();
    const due = race
      .framesOfLap(70)
      .filter((frame) => {
        const { delta } = race.viewAt(frame);
        return (delta.after.laps ?? 0) > (delta.before.laps ?? 0);
      })
      .map((frame) => {
        const view = race.viewAt(frame);
        return { ...view, outputs: upstreamOf(view) };
      });
    expect(due.length).toBeGreaterThan(0);
    for (const view of due) driverNoiseCalculator.compute(view); // warm
    let total = 0;
    for (const view of due) {
      let best = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        driverNoiseCalculator.compute(view);
        best = Math.min(best, performance.now() - start);
      }
      total += best;
    }
    const perFrame = total / REAL_FRAMES_PER_LAP;
    console.info(`[driver-noise budget] ${due.length} runs over a real lap of ${REAL_FRAMES_PER_LAP} frames: ${perFrame.toFixed(3)} ms per frame (target ${TARGET_MS_PER_FRAME} ms)`);
    expect(perFrame).toBeLessThan(TARGET_MS_PER_FRAME);
  });
});
