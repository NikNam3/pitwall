// `degradation`'s budget (spec 8): a quick calculator from scratch over the projection (C31 not needed) stays under
// 1 ms per lap update on the long-race builder (70 laps, 20 cars), late in the race where the projection is largest.
import { describe, expect, it } from 'vitest';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';

/** Warm passes per lap update; the best of them counts (R23). */
const PASSES = 25;

describe('degradation budget', () => {
  it('long-race budget: under 1 ms per lap update', () => {
    const race = longRace();
    // a lap update: the first frame of each of the leader's laps 60..70, when the field completes the lap before
    const views = Array.from({ length: 11 }, (_, i) => race.viewAt(race.framesOfLap(60 + i)[0]!));
    for (const view of views) degradationCalculator.compute(view); // warm
    // per lap the best of 25 warm passes, so machine load (a parallel suite, a busy core) cannot flake it (docs/testing.md 6)
    const best = views.map((view) => {
      let ms = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        degradationCalculator.compute(view);
        ms = Math.min(ms, performance.now() - start);
      }
      return ms;
    });
    const median = [...best].sort((a, b) => a - b)[best.length >> 1]!;
    expect(median).toBeLessThan(1);
  });
});
