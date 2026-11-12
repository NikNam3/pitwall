// `forecast-field`'s budget (SP4.3a spec 10, plan Task 16 row 7): one build of the starting point stays under 2 ms on
// the long-race builder (70 laps, 20 cars) at the leader's lap 70, where the projection is largest. The build is
// `buildStartingPoint` without lap progress (the as-of placement, as the scoreboard builds about 280 a job); the units'
// outputs are computed outside the timing (each unit has its own budget). Best of warm passes (docs/testing.md 6).
import { asOfNow } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { buildStartingPoint } from '../../../src/shared/forecast-field/index.ts';
import { longRace } from '../../../../../test-support/builders/long-race.ts';
import { materialised, plainNoise, TRACK, upstreamOf } from './support.ts';

const WARM = 5;
const PASSES = 25;
const TARGET_MS = 2;

describe('forecast-field budget', () => {
  it(`budget: one build under ${TARGET_MS} ms on the long race at lap 70`, () => {
    const race = longRace();
    const frame = race.framesOfLap(70)[0]!;
    const view = materialised(asOfNow({ ...race.viewAt(frame), track: TRACK }));
    const outputs = upstreamOf(view, plainNoise(race.cars, [], view.at));
    const sp = buildStartingPoint(view, outputs);
    expect(sp.known).toBe(true);
    for (let k = 0; k < WARM; k++) buildStartingPoint(view, outputs);
    let best = Infinity;
    for (let k = 0; k < PASSES; k++) {
      const start = performance.now();
      buildStartingPoint(view, outputs);
      best = Math.min(best, performance.now() - start);
    }
    console.info(`[forecast-field budget] ${best.toFixed(3)} ms per build at lap 70 (${race.cars} cars), target ${TARGET_MS} ms`);
    expect(best).toBeLessThan(TARGET_MS);
  });
});
