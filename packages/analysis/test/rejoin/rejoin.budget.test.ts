// `rejoin`'s per-frame budget (SP4.3d spec §6.5, §8; SP4.3d1 Task 7 row 6): `rejoin` runs on every frame, so on the
// long race (`test-support/builders`, 70 laps, 20 cars) at lap 35 its `compute` takes at most TARGET_MS per frame,
// averaged over the frames of the lap. `gaps` and `pit-loss` are its upstream outputs, computed once per frame outside
// the timer (`gaps` from scratch, `pit-loss` the built races' losses). Without the read-counting proxy; each pass counts
// its best of several warm passes, so machine load cannot flake it (docs/testing.md 6). The timer is in this test only.
// The answers are the other rejoin tests'.
import { carId } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { GAPS } from '../../src/gaps/index.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import type { RejoinOutput } from '../../src/rejoin/index.ts';
import { pitLosses } from './field.ts';

const LAP = 35;
const PASSES = 6;
/** At most 0.2 ms per frame (spec §8). */
const TARGET_MS = 0.2;

describe('rejoin budget', () => {
  it(`budget: compute on every frame of lap ${LAP} of the long race (20 cars) at most ${TARGET_MS} ms per frame`, () => {
    const race = longRace();
    const views: EngineView[] = race.framesOfLap(LAP).map((frame) => {
      const view = race.viewAt(frame);
      const gaps = gapsCalculator.output(gapsCalculator.init(view), view);
      return {
        ...view,
        outputs: new Map<string, unknown>([
          [GAPS, gaps],
          [PIT_LOSS, pitLosses()],
        ]),
      };
    });
    expect(views.length).toBeGreaterThan(0);
    expect(views[0]!.live.cars.filter((c) => c.timing.lap > 1).length).toBeGreaterThanOrEqual(20);
    const pass = (): RejoinOutput[] => views.map((view) => rejoinCalculator.compute(view));
    const expected = pass(); // warm
    // our car (0) is on a racing lap at lap 35: every frame has its entry, the green order known
    for (const out of expected) expect(out.cars[carId(0)]?.conditions.green.order.known).toBe(true);
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      const outputs = pass();
      best = Math.min(best, performance.now() - start);
      expect(outputs.length).toBe(expected.length);
    }
    const perFrame = best / views.length;
    console.info(`[rejoin budget] ${views.length} frames: ${perFrame.toFixed(3)} ms per frame (target ${TARGET_MS} ms)`);
    expect(perFrame).toBeLessThanOrEqual(TARGET_MS);
  }, 120_000);
});
