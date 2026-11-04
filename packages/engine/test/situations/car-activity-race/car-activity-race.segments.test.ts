// The race's car-activity sub-machine on committed segments (contract C14, C17, C18, C26, C84, C85; facts in
// fixtures/index.json and docs/research/09-situations-inventory.md §2.5, §2.7, §2.10). Every segment joins a race in
// progress, so each car's first span is its current activity with `joinedAt`, opened on the machine's first frame (the
// race session phase's first). Every expected frame is read from the segment's own signals and values by the machine's
// rules (car-activity-race.transitions.ts), never a fact of the recording:
// - race-zandvoort-pit-stop (ZvR2 548.2-555 s): the player (car 1) enters the pit lane and stops in its box;
// - race-zandvoort-pit-exit (ZvR2 564.5-566 s): the player in the pit lane after its stop;
// - race-drive-through (MiR 1530.5-1534 s): the player (car 19) is given a drive-through on track;
// - race-drive-through-served (new, MiR 1631-1639.2 s): the player in the pit lane past its box on the drive-through
//   visit, the pit exit at 1631.735 and its DTSV 7.1 s later (Review Focus 5);
// - race-miami-finish (new, MiR 2266.5-2271 s): car 9 and the player take the flag (the result status finished a frame
//   after the crossing), cars 1 and 6 are set finished mid-lap on the last frame (Review Focus 3), the cars that
//   finished before the segment cool down, car 18 is retired, slots 20 and 21 hold no car.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PitStatus, ResultStatus } from '@pitwall/domain';
import type { StepResult } from '../../../src/index.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { MACHINE } from './inputs.ts';

type Seen = { pit: PitStatus[]; result: ResultStatus[]; distance: number[]; stopTimer: number[]; events: string[] };
const seenOf = (state: StepResult['state']): Seen => ({
  pit: state.signals.cars.map((c) => c.pitStatus),
  result: state.signals.cars.map((c) => c.resultStatus),
  distance: state.cars.map((c) => c.timing.lapDistanceM),
  stopTimer: state.cars.map((c) => c.timing.pitStopTimerMs),
  events: state.signals.events.map((e) => ('carId' in e && e.carId !== undefined ? `${e.code}:${e.carId}` : e.code)),
});

type Seg = SegmentRun<Seen>;
const load = (file: string) => replaySegment(file, seenOf);
/** Car `car`'s activity spans: kind, joined, the frames each covers, confirmed, detail. */
const spansOf = (seg: Seg, car: number) =>
  seg
    .spans(MACHINE)
    .filter((s) => s.carId === car)
    .map((s) => ({ kind: s.kind, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame, confirmed: s.confirmed, detail: s.detail }));
/** The machine's first frame: the race session phase's first span opens on it (the segment's race is under way). */
const firstOf = (seg: Seg): number => seg.spans('session-phase-race')[0]!.startFrame;
/** The frame number of the first frame whose observation satisfies `test`. */
const firstFrame = (seg: Seg, test: (seen: Seen) => boolean): number => seg.frames.find((f) => test(f.value))!.frameNumber;
const frameAt = (seg: Seg, frameNumber: number): Seen => seg.frames.find((f) => f.frameNumber === frameNumber)!.value;
const afterLast = (seg: Seg): number => seg.frames.at(-1)!.frameNumber + 1;
/** One span from the machine's first frame to the session's close: the car's current activity, joined. */
const throughout = (seg: Seg, kind: string) => [{ kind, joinedAt: true, startFrame: firstOf(seg), endFrame: afterLast(seg), confirmed: true, detail: undefined }];

describe('car-activity-race: race-zandvoort-pit-stop (ZvR2: the player enters the pit lane at 548.387 and stops in its box at 553.276)', () => {
  let seg: Seg;
  beforeAll(async () => {
    seg = await load('race-zandvoort-pit-stop.pwrec.gz');
  });
  it('car 1 is racingLap (joined), inLap from the frame its pit status turned pitting, boxStop from the frame it turned in the pit area, to the end', () => {
    const first = firstOf(seg);
    const entry = firstFrame(seg, (v) => v.pit[1] === 'pitting');
    const box = firstFrame(seg, (v) => v.pit[1] === 'inPitArea');
    expect(first < entry && entry < box).toBe(true);
    expect(spansOf(seg, 1)).toEqual([
      { kind: 'racingLap', joinedAt: true, startFrame: first, endFrame: entry, confirmed: true, detail: undefined },
      { kind: 'inLap', joinedAt: undefined, startFrame: entry, endFrame: box, confirmed: true, detail: undefined },
      { kind: 'boxStop', joinedAt: undefined, startFrame: box, endFrame: afterLast(seg), confirmed: true, detail: undefined },
    ]);
  });
});

describe('car-activity-race: race-zandvoort-pit-exit (ZvR2: the player in the pit lane after its stop; the pit exit lies after the segment)', () => {
  it('car 1, in the pit lane past its box (pit stop timer above 0) on every frame, is one outLap span (joined)', async () => {
    const seg = await load('race-zandvoort-pit-exit.pwrec.gz');
    expect(seg.frames.every((f) => f.value.pit[1] === 'pitting' && f.value.stopTimer[1]! > 0)).toBe(true);
    expect(spansOf(seg, 1)).toEqual(throughout(seg, 'outLap'));
  });
});

describe('car-activity-race: race-drive-through (MiR: the player is given a drive-through at 1531.797, served outside the segment)', () => {
  it('car 19 is one racingLap span (joined): a penalty given opens nothing until the car enters the pit lane', async () => {
    const seg = await load('race-drive-through.pwrec.gz');
    expect(seg.spans('penalties').some((s) => s.carId === 19 && s.kind === 'driveThroughPending')).toBe(true);
    expect(spansOf(seg, 19)).toEqual(throughout(seg, 'racingLap'));
  });
});

describe('car-activity-race: race-drive-through-served (MiR: the player past its box on its drive-through visit, the pit exit at 1631.735, its DTSV at 1638.850)', () => {
  it('car 19 is servingPenalty (joined) naming the drive-through it owes, open past the pit exit and closed confirmed on the DTSV frame; outLap from it to the end (C18)', async () => {
    const seg = await load('race-drive-through-served.pwrec.gz');
    const first = firstOf(seg);
    const exit = firstFrame(seg, (v) => v.pit[19] === 'none');
    const served = firstFrame(seg, (v) => v.events.includes('DTSV:19'));
    expect(first < exit && exit < served).toBe(true);
    expect(frameAt(seg, first).pit[19]).toBe('pitting');
    const given = seg.spans('penalties').find((s) => s.carId === 19 && s.startFrame <= first && first < s.endFrame)!;
    expect(given.kind).toBe('driveThroughPending');
    expect(spansOf(seg, 19)).toEqual([
      {
        kind: 'servingPenalty',
        joinedAt: true,
        startFrame: first,
        endFrame: served,
        confirmed: true,
        detail: { penalty: 'driveThrough', given: { machine: 'penalties', carId: 19, spanId: given.id } },
      },
      { kind: 'outLap', joinedAt: undefined, startFrame: served, endFrame: afterLast(seg), confirmed: true, detail: undefined },
    ]);
  });
});

describe('car-activity-race: race-miami-finish (MiR: the chequered flag at 2266.835, car 9 finishes at 2267.698, the player at 2270.688, SEND at 2270.718)', () => {
  let seg: Seg;
  beforeAll(async () => {
    seg = await load('race-miami-finish.pwrec.gz');
  });
  /** The frame car `car`'s result status turned finished; the frame before it shows its line crossing (the lap distance fell). */
  const finishOf = (car: number): number => {
    const finished = firstFrame(seg, (v) => v.result[car] === 'finished');
    const k = seg.frames.findIndex((f) => f.frameNumber === finished);
    expect(k).toBeGreaterThan(1);
    expect(seg.frames[k - 1]!.value.distance[car]!).toBeLessThan(seg.frames[k - 2]!.value.distance[car]!);
    return finished;
  };

  it.each([9, 19])('car %i is racingLap (joined), finished for the frame its result status turned finished, then coolDown to the end', (car) => {
    const finished = finishOf(car);
    expect(seg.frames.some((f) => f.frameNumber === finished + 1)).toBe(true);
    expect(spansOf(seg, car)).toEqual([
      { kind: 'racingLap', joinedAt: true, startFrame: firstOf(seg), endFrame: finished, confirmed: true, detail: undefined },
      { kind: 'finished', joinedAt: undefined, startFrame: finished, endFrame: finished + 1, confirmed: true, detail: undefined },
      { kind: 'coolDown', joinedAt: undefined, startFrame: finished + 1, endFrame: afterLast(seg), confirmed: true, detail: undefined },
    ]);
  });
  it.each([1, 6])('car %i, set finished mid-lap on the last frame without crossing the line, stays one racingLap span (Review Focus 3)', (car) => {
    const last = seg.frames.at(-1)!.value;
    expect(last.result[car]).toBe('finished');
    expect(seg.frames.at(-2)!.value.result[car]).toBe('active');
    expect(spansOf(seg, car)).toEqual(throughout(seg, 'racingLap'));
  });
  it('every car finished on the machine’s first frame is one coolDown span (joined)', () => {
    const atStart = frameAt(seg, firstOf(seg));
    const done = atStart.result.flatMap((r, car) => (r === 'finished' ? [car] : []));
    expect(done.length).toBeGreaterThan(0);
    for (const car of done) expect(spansOf(seg, car), `car ${car}`).toEqual(throughout(seg, 'coolDown'));
  });
  it('car 18, retired, and slots 20 and 21, holding no car, are one notCompeting span each (joined)', () => {
    expect(frameAt(seg, firstOf(seg)).result[18]).toBe('retired');
    for (const car of [18, 20, 21]) expect(spansOf(seg, car), `car ${car}`).toEqual(throughout(seg, 'notCompeting'));
  });
});
