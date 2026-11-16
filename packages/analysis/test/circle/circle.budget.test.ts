// `circle`'s per-frame budget (SP4.3d spec §6.5, §8; SP4.3d1 Task 8 row 5): `circle` runs on every frame, so on the
// long race (`test-support/builders`, 70 laps, 20 cars) at lap 35 its `compute` takes at most TARGET_MS per frame,
// averaged over the frames of the lap. `gaps`, `pit-loss` and `rejoin` are its upstream outputs, computed once per frame
// outside the timer (`long-race.ts`). Without the read-counting proxy; each pass counts its best of several warm passes,
// so machine load cannot flake it (docs/testing.md 6). The timer is in this test only. The answers are the other
// circle tests'.
import { carId } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { circleCalculator } from '../../src/circle/calculator.ts';
import type { CircleOutput } from '../../src/circle/index.ts';
import { circleViewAt } from './long-race.ts';

const LAP = 35;
const PASSES = 6;
/** At most 0.2 ms per frame (spec §8). */
const TARGET_MS = 0.2;

describe('circle budget', () => {
  it(`budget: compute on every frame of lap ${LAP} of the long race (20 cars) at most ${TARGET_MS} ms per frame`, () => {
    const race = longRace();
    const views: EngineView[] = race.framesOfLap(LAP).map((frame) => circleViewAt(race, frame));
    expect(views.length).toBeGreaterThan(0);
    expect(views[0]!.live.cars.filter((c) => c.timing.lap > 1).length).toBeGreaterThanOrEqual(20);
    const pass = (): CircleOutput[] => views.map((view) => circleCalculator.compute(view));
    const expected = pass(); // warm
    // our car (0) on lap 35: every frame has its circle, its cars known, the whole field on it
    for (const out of expected) {
      const c = out.cars[carId(0)];
      expect(c?.cars.known).toBe(true);
      if (c?.cars.known) expect(c.cars.value.length).toBeGreaterThanOrEqual(15);
    }
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      const outputs = pass();
      best = Math.min(best, performance.now() - start);
      expect(outputs.length).toBe(expected.length);
    }
    const perFrame = best / views.length;
    console.info(`[circle budget] ${views.length} frames: ${perFrame.toFixed(3)} ms per frame (target ${TARGET_MS} ms)`);
    expect(perFrame).toBeLessThanOrEqual(TARGET_MS);
  }, 120_000);
});
