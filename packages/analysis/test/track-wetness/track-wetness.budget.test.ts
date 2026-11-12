// `track-wetness`'s budget (SP4.3a spec 10, plan Task 9 R5): under 0.2 ms per frame, averaged over the frames of the
// leader's lap 70 of the long-race builder (20 cars, 70 laps), where the projection is largest. Its cadence is
// `lapCompleted`: it runs on the frames that append a lap record, so the lap's cost is its runs on those frames, spread
// over every frame of the lap. Each run counts its best of several warm passes, so machine load cannot flake it
// (docs/testing.md 6). `degradation`'s output, its upstream, is computed beforehand and not timed.
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';

const PASSES = 25;
const TARGET_MS_PER_FRAME = 0.2;
/** A real lap's frames (about 90 s at the game's ~55 Hz, 20 cars): the builder holds only 20 frames per lap, so its own count would turn a per-frame budget into a per-run one (ruling R25). */
const REAL_FRAMES_PER_LAP = 5_000;

describe('track-wetness budget', () => {
  it(`long-race budget: under ${TARGET_MS_PER_FRAME} ms per frame averaged over lap 70`, () => {
    const race = longRace();
    const frames = race.framesOfLap(70);
    // the frames its cadence runs on: those that append a lap record
    const due = frames
      .filter((frame) => {
        const { delta } = race.viewAt(frame);
        return (delta.after.laps ?? 0) > (delta.before.laps ?? 0);
      })
      .map((frame) => race.viewAt(frame, { outputs: new Map([[DEGRADATION, degradationCalculator.compute(race.viewAt(frame))]]) }));
    expect(due.length).toBeGreaterThan(0);
    for (const view of due) trackWetnessCalculator.compute(view); // warm
    let total = 0;
    for (const view of due) {
      let best = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        trackWetnessCalculator.compute(view);
        best = Math.min(best, performance.now() - start);
      }
      total += best;
    }
    const perFrame = total / REAL_FRAMES_PER_LAP;
    console.info(`[track-wetness budget] ${due.length} runs over a real lap of ${REAL_FRAMES_PER_LAP} frames: ${perFrame.toFixed(3)} ms per frame (target ${TARGET_MS_PER_FRAME} ms)`);
    expect(perFrame).toBeLessThan(TARGET_MS_PER_FRAME);
  });
});
