// `rival-stops`'s budget (SP4.3a spec 10; plan Task 11 R5): a quick calculator from scratch over the projection (C31
// not needed) stays under 0.2 ms per frame, averaged over lap 70 of the long-race builder (70 laps, 20 cars), where the
// projection is largest. It runs on `lapCompleted`: its time over the frames of the leader's lap 70 on which a lap was
// appended, divided by every frame of that lap. Upstream outputs are computed outside the timing.
import { describe, expect, it } from 'vitest';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { rivalStopsCalculator } from '../../src/rival-stops/calculator.ts';
import { SESSION_REMAINING } from '../../src/session-remaining/index.ts';
import { sessionRemainingCalculator } from '../../src/session-remaining/calculator.ts';
import { TYRE_LIFE } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';

/** Warm passes per frame; the best of them counts (docs/testing.md 6). */
const PASSES = 25;
const TARGET_MS = 0.2;
/** A real lap's frames (about 90 s at the game's ~55 Hz): the builder holds only 20 frames per lap (ruling R25). */
const REAL_FRAMES_PER_LAP = 5_000;

describe('rival-stops budget', () => {
  it(`R5 budget: under ${TARGET_MS} ms per frame averaged over lap 70 of the long race`, () => {
    const race = longRace();
    const frames = race.framesOfLap(70);
    expect(frames.length).toBeGreaterThan(0);
    const views = frames
      .map((frame) => {
        const outputs = new Map<string, unknown>();
        outputs.set(DEGRADATION, degradationCalculator.compute(race.viewAt(frame, { outputs })));
        outputs.set(TYRE_LIFE, tyreLifeCalculator.compute(race.viewAt(frame, { outputs })));
        outputs.set(SESSION_REMAINING, sessionRemainingCalculator.compute(race.viewAt(frame, { outputs })));
        return race.viewAt(frame, { outputs });
      })
      // the frames its cadence runs it on: a lap was appended
      .filter((view) => (view.delta.after.laps ?? 0) > (view.delta.before.laps ?? 0));
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) rivalStopsCalculator.compute(view); // warm
    let total = 0;
    for (const view of views) {
      let best = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        rivalStopsCalculator.compute(view);
        best = Math.min(best, performance.now() - start);
      }
      total += best;
    }
    const perFrame = total / REAL_FRAMES_PER_LAP;
    console.info(`[rival-stops budget] ${perFrame.toFixed(3)} ms per frame over a real lap of ${REAL_FRAMES_PER_LAP} frames (${views.length} runs), target ${TARGET_MS} ms`);
    expect(perFrame).toBeLessThan(TARGET_MS);
  });
});
