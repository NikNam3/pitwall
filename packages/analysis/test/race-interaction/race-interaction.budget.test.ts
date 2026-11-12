// R5 of `race-interaction` (SP4.3a plan Task 12): a quick calculator from scratch over the projection, at cadence
// `lapCompleted`, stays under 0.2 ms per frame averaged over the leader's lap 70 of the long race (70 laps, 20 cars, the
// Zandvoort track file's braking and DRS zones): the time of its runs on the frames a lap record was appended (the
// frames it is due), summed and divided by the lap's frames.
import { known } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';

/** Warm passes per due frame; the best of them counts (docs/testing.md 6). */
const PASSES = 25;
const TARGET_MS = 0.2;

describe('race-interaction budget', () => {
  it('budget: under 0.2 ms per frame averaged over lap 70 of the long race', () => {
    const race = longRace();
    const track = known(zandvoortTrack(), 0);
    const frames = race.framesOfLap(70);
    const views = frames.map((frame) => ({ ...race.viewAt(frame), track }));
    // due: the frame appended a lap record (`lapCompleted`)
    const due = views.filter((v) => (v.delta.after.laps ?? 0) > (v.delta.before.laps ?? 0));
    expect(due.length).toBeGreaterThan(0);
    for (const view of due) raceInteractionCalculator.compute(view); // warm
    let total = 0;
    for (const view of due) {
      let ms = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        raceInteractionCalculator.compute(view);
        ms = Math.min(ms, performance.now() - start);
      }
      total += ms;
    }
    const perFrame = total / frames.length;
    console.info(`[race-interaction budget] ${perFrame.toFixed(3)} ms per frame over ${frames.length} frames (${due.length} due), target ${TARGET_MS} ms`);
    expect(perFrame).toBeLessThan(TARGET_MS);
  });
});
