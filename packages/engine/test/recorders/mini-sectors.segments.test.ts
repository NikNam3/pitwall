// The mini-sectors recorder on a committed segment (contract C10, C26, C84; migration Task 21, rulings 3 and 4; facts in
// fixtures/index.json and docs/research/09-situations-inventory.md §2.10): race-miami-finish (MiR 2266.5-2271 s), the
// last lap. Car 9 and the player (car 19) cross the line into their finish (the lap distance falls, the lap number
// stays) and turn finished one frame later: each finisher's final lap has its line crossing, segment 0 of the next lap
// `(lap + 1, 0)`, describing the frame the lap distance wrapped on. The cars that finished before the segment drive
// their cool-down: no crossing describes a frame of a car's coolDown span. Every expected frame is read from the
// segment's own values and spans, never a fact of the recording.
import { beforeAll, describe, expect, it } from 'vitest';
import { MINI_SECTORS, type MiniSectorCrossing } from '@pitwall/domain';
import type { StepResult } from '../../src/index.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { replaySegment, type SegmentRun } from '../support/segment-run.ts';
import { SEGMENTS } from '../../../../test-support/segments.ts';

const CARS = [9, 19] as const;
/** Per frame: every car's lap and lap distance, the race clock, the track length, and the projection's crossings (the list itself: it only grows here). */
type Seen = { lap: number[]; distance: number[]; at: number; trackLengthM: number; crossings: DeepReadonly<MiniSectorCrossing[]> };
const seenOf = (state: StepResult['state']): Seen => ({
  lap: state.cars.map((c) => c.timing.lap),
  distance: state.cars.map((c) => c.timing.lapDistanceM),
  at: state.sessionTime,
  trackLengthM: state.session.trackLengthM,
  crossings: state.history.crossings,
});

describe('mini-sector crossings: race-miami-finish (MiR: car 9 crosses at 2267.670, the player at 2270.659; the lap number stays 20)', () => {
  let seg: SegmentRun<Seen>;
  beforeAll(async () => {
    seg = await replaySegment('race-miami-finish.pwrec.gz', seenOf);
  });
  /** The index among the applied frames on which car `car`'s lap distance falls: its crossing. */
  const crossingIndexOf = (car: number): number => {
    const k = seg.frames.findIndex((f, i) => i > 0 && f.value.distance[car]! < seg.frames[i - 1]!.value.distance[car]!);
    expect(k).toBeGreaterThan(0);
    return k;
  };
  const crossings = () => seg.frames.at(-1)!.value.crossings;
  /** Car `car`'s coolDown spans as the frames they cover (C26). */
  const coolDowns = (car: number) => seg.spans('car-activity-race').filter((s) => s.carId === car && s.kind === 'coolDown');
  const inCoolDown = (car: number, frame: number) => coolDowns(car).some((s) => s.startFrame <= frame && frame < s.endFrame);

  it.each(CARS)('car %i: its final lap has its line crossing, (lap + 1, 0) at the wrap, describing the frame the lap distance fell on', (car) => {
    const k = crossingIndexOf(car);
    const [before, at] = [seg.frames[k - 1]!, seg.frames[k]!];
    // the lap number stays at the crossing (the game does not raise it at the chequered flag)
    expect(at.value.lap[car]).toBe(before.value.lap[car]);
    const line = crossings().filter((c) => c.carId === car && c.lap === at.value.lap[car]! + 1 && c.segment === 0);
    expect(line).toHaveLength(1);
    expect(line[0]!.frame).toBe(at.frameNumber);
    expect(line[0]!.at).toBeGreaterThanOrEqual(before.value.at);
    expect(line[0]!.at).toBeLessThanOrEqual(at.value.at);
  });
  it('no crossing describes a frame of its car’s coolDown span, though cars in their cool-down pass mini-sector boundaries', () => {
    const segmentOf = (f: Seen, car: number) => Math.floor((f.distance[car]! * MINI_SECTORS) / f.trackLengthM);
    // the cars that cross a boundary between two frames of their cool-down (from their own values): the row is not empty
    const driving = seg.frames.flatMap((f, i) => {
      if (i === 0) return [];
      const prev = seg.frames[i - 1]!;
      return f.value.distance.flatMap((_, car) =>
        inCoolDown(car, prev.frameNumber) && inCoolDown(car, f.frameNumber) && segmentOf(f.value, car) > segmentOf(prev.value, car) ? [car] : []);
    });
    expect(driving.length).toBeGreaterThan(0);
    expect(crossings().filter((c) => inCoolDown(c.carId, c.frame))).toEqual([]);
  });
});

// practice-garage-restart-line (practiceLiveTest 1118-1135 s; fixtures/index.json): the player (car 19) ends its out lap
// from the garage at the line at about 1122.6 s with the lap number staying 7; car-activity-practice opens flyingLap
// there (not joined), so the lap restarts (`lapStepOf`, live-test fixes Task 2). From that frame the crossings of lap 7
// are recorded again from the line: segment 0 on the frame the flying lap opens, then every segment in order. The
// earlier passes of these segments lie before the segment, so none of them supersedes a crossing (C25). The frame is
// read from the segment's own spans, never a fact of the recording.
describe('mini-sector crossings: practice-garage-restart-line (the player’s out lap ends at the line on lap 7)', () => {
  const PLAYER = 19;
  let seg: SegmentRun<DeepReadonly<MiniSectorCrossing[]>>;
  beforeAll(async () => {
    seg = await replaySegment(SEGMENTS.practiceGarageRestartLine, (state) => state.history.crossings);
  });

  it('after the line, the crossings of lap 7 are appended again from segment 0, in increasing segment order, superseding nothing', () => {
    const push = seg.spans('car-activity-practice').find((s) => s.carId === PLAYER && s.kind === 'flyingLap' && s.joinedAt === undefined);
    expect(push).toBeDefined();
    const again = seg.frames.at(-1)!.value.filter((c) => c.carId === PLAYER && c.lap === 7 && c.frame >= push!.startFrame);
    expect(again.length).toBeGreaterThan(0);
    expect(again[0]).toMatchObject({ segment: 0, frame: push!.startFrame });
    expect(again.map((c) => c.segment)).toEqual(Array.from({ length: again.length }, (_, s) => s));
    expect(again.filter((c) => c.supersedes !== undefined)).toEqual([]);
  });
});
