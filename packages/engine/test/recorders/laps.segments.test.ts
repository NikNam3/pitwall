// The laps recorder on a committed segment (contract C10, C25, C26, C84; Task 17 fix round 1, M3 review B1; facts in
// fixtures/index.json and docs/research/09-situations-inventory.md §2.10): race-miami-finish (MiR 2266.5-2271 s), the
// last lap. Car 9 and the player (car 19) cross the line into their finish (the lap distance falls, the lap number
// stays) and turn finished one frame later; Session History confirms each final lap later, car 9's in its cool-down and
// the player's on the last frame (SEND). Every expected frame is read from the segment's own values and spans, never a
// fact of the recording.
import { beforeAll, describe, expect, it } from 'vitest';
import type { LapRecord } from '@pitwall/domain';
import type { StepResult } from '../../src/index.ts';
import { membershipOf } from '../../src/readers.ts';
import { situationOf } from '../../src/situations/run.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { replaySegment, type SegmentRun } from '../support/segment-run.ts';

const CARS = [9, 19] as const;
/** A lap of the projection, with the kinds of the car's activity and the session phase it belongs to (`membershipOf`). */
type Seen = { distance: number[]; laps: Array<DeepReadonly<LapRecord> & { index: number; activity: string | undefined; phase: string | undefined }> };
const seenOf = (state: StepResult['state']): Seen => {
  const source = { history: state.history, situation: situationOf(state) };
  return {
    distance: state.cars.map((c) => c.timing.lapDistanceM),
    laps: state.history.laps.flatMap((l, index) => {
      if (!(CARS as readonly number[]).includes(l.carId)) return [];
      const member = membershipOf(source, l);
      // `index`: the lap's position in the projection's laps, its id (C21; the segment has no void and no hidden lap)
      return [{ ...l, index, activity: member['car-activity-race']?.kind, phase: member['session-phase-race']?.kind }];
    }),
  };
};

describe('laps: race-miami-finish (MiR: car 9 crosses at 2267.670, the player at 2270.659; the lap number stays 20)', () => {
  let seg: SegmentRun<Seen>;
  beforeAll(async () => {
    seg = await replaySegment('race-miami-finish.pwrec.gz', seenOf);
  });
  /** The frame on which car `car`'s lap distance falls: its crossing. */
  const crossingOf = (car: number): number => {
    const k = seg.frames.findIndex((f, i) => i > 0 && f.value.distance[car]! < seg.frames[i - 1]!.value.distance[car]!);
    expect(k).toBeGreaterThan(0);
    return seg.frames[k]!.frameNumber;
  };
  /** Car `car`'s laps of its last lap number, as the projection holds them on the last frame. */
  const finalLaps = (car: number) => {
    const laps = seg.frames.at(-1)!.value.laps.filter((l) => l.carId === car);
    const last = Math.max(...laps.map((l) => l.lapNumber));
    return laps.filter((l) => l.lapNumber === last);
  };

  it.each(CARS)('car %i: the provisional final lap and its confirmed version describe the crossing; the confirmed one supersedes the provisional', (car) => {
    const crossing = crossingOf(car);
    const laps = finalLaps(car);
    expect(laps.map((l) => [l.status, l.frame])).toEqual([['provisional', crossing], ['confirmed', crossing]]);
    expect(laps[0]!.supersedes).toBeUndefined();
    expect(laps[1]!.supersedes).toEqual({ list: 'laps', index: laps[0]!.index });
    expect(laps[1]!.completedAt).toBe(laps[0]!.completedAt);
  });
  it.each(CARS)('car %i: the final lap belongs to the spans open at its crossing (racing activity, the finished session), never to the cool-down', (car) => {
    const crossing = crossingOf(car);
    const activity = seg.spans('car-activity-race').find((s) => s.carId === car && s.startFrame <= crossing && crossing < s.endFrame)!;
    expect(['racingLap', 'finished']).toContain(activity.kind);
    for (const lap of finalLaps(car)) expect([lap.activity, lap.phase]).toEqual([activity.kind, 'finished']);
  });
});
