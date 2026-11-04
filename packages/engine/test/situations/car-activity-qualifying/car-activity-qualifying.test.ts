// The qualifying car-activity sub-machine (contract C3, C9, C14, C15, C17, C18, C19, C26, C85): per car, what it is
// doing by qualifying's rules (out lap, push lap, in lap, garage, finished, not competing), for the qualifying phase (the
// sprint shootout included); its spans declared in domain (`carActivityQualifyingSpans`). The rules and transition
// rows: `car-activity-timed/rows.ts` (car-activity-qualifying.transitions.ts); the shared behaviour:
// `car-activity-timed/behaviour.ts`. Segments (their first frame carries Participants): a full lap of Q2 with out laps,
// push laps and AI in laps (qualifying-singapore-full-lap, SgQ 166.4-259.7 s), the time-out (qualifying-singapore-end,
// SgQ 899-900.6 s).
import { beforeAll, describe, expect, it } from 'vitest';
import { carActivityQualifyingSpans } from '@pitwall/domain';
import machine from '../../../src/situations/car-activity-qualifying/machine.ts';
import { describeTimedActivity } from '../car-activity-timed/behaviour.ts';
import { afterLast, firstFrame, replayCars, spansOf, type Seen } from '../car-activity-timed/segments.ts';
import { qualifying } from './car-activity-qualifying.transitions.ts';

const ID = 'car-activity-qualifying';

describeTimedActivity({ machine, spans: carActivityQualifyingSpans, phase: 'qualifying', sessionPhaseId: 'session-phase-qualifying', push: 'pushLap', t: qualifying });

describe('car-activity-qualifying: qualifying-singapore-full-lap (SgQ Q2 166.4-259.7 s; car 14 the player)', () => {
  let seg: Seen;
  beforeAll(async () => {
    seg = await replayCars('qualifying-singapore-full-lap.pwrec.gz');
  }, 120_000);
  it('car 14 is outLap (joined, before the line from its garage) until the frame its lap distance reaches 0, then pushLap to the end: its next line (lap 1 -> 2 at 258.966) opens nothing', () => {
    const line = firstFrame(seg, 14, (c) => c.d >= 0);
    expect(line).toBeGreaterThan(1);
    expect(spansOf(seg, ID, 14)).toEqual([
      { kind: 'outLap', joinedAt: true, startFrame: 1, endFrame: line },
      { kind: 'pushLap', joinedAt: undefined, startFrame: line, endFrame: afterLast(seg) },
    ]);
  });
  it('car 8 is pushLap (joined), then inLap from the frame its driver status turns in lap, a frame after its line (221.966 / 221.986)', () => {
    const inLap = firstFrame(seg, 8, (c) => c.ds === 'inLap');
    expect(inLap).toBeGreaterThan(1);
    expect(spansOf(seg, ID, 8)).toEqual([
      { kind: 'pushLap', joinedAt: true, startFrame: 1, endFrame: inLap },
      { kind: 'inLap', joinedAt: undefined, startFrame: inLap, endFrame: afterLast(seg) },
    ]);
  });
  it('car 5 is garage (joined), then outLap from the frame it leaves the garage (212.067) through its pit exit (218.853) to the end', () => {
    const leaves = firstFrame(seg, 5, (c) => c.ds === 'outLap');
    expect(leaves).toBeGreaterThan(1);
    expect(spansOf(seg, ID, 5)).toEqual([
      { kind: 'garage', joinedAt: true, startFrame: 1, endFrame: leaves },
      { kind: 'outLap', joinedAt: undefined, startFrame: leaves, endFrame: afterLast(seg) },
    ]);
  });
  it('car 12 is outLap (joined) until the frame its lap distance reaches 0 (252.415), then pushLap', () => {
    const line = firstFrame(seg, 12, (c) => c.d >= 0);
    expect(spansOf(seg, ID, 12)).toEqual([
      { kind: 'outLap', joinedAt: true, startFrame: 1, endFrame: line },
      { kind: 'pushLap', joinedAt: undefined, startFrame: line, endFrame: afterLast(seg) },
    ]);
  });
  it('the practice machine has no span in qualifying (C14)', () => {
    expect(seg.spans('car-activity-practice')).toEqual([]);
  });
});

describe('car-activity-qualifying: qualifying-singapore-end (SgQ 899-900.6 s: the time-out at 900.594 sets every car finished wherever it is)', () => {
  let seg: Seen;
  beforeAll(async () => {
    seg = await replayCars('qualifying-singapore-end.pwrec.gz');
  });
  it('car 14, the player in its garage, is one garage span', () => {
    expect(spansOf(seg, ID, 14)).toEqual([{ kind: 'garage', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('car 0, on its push lap 110 m before the line, is pushLap (joined), then inLap from the time-out frame: no finished (Review Focus 3)', () => {
    const timeOut = firstFrame(seg, 0, (c) => c.rs === 'finished');
    expect(timeOut).toBeGreaterThan(1);
    expect(spansOf(seg, ID, 0)).toEqual([
      { kind: 'pushLap', joinedAt: true, startFrame: 1, endFrame: timeOut },
      { kind: 'inLap', joinedAt: undefined, startFrame: timeOut, endFrame: afterLast(seg) },
    ]);
  });
  it('car 3, its lap begun just before, is pushLap (joined), then inLap from the frame its driver status turns in lap (900.062)', () => {
    const inLap = firstFrame(seg, 3, (c) => c.ds === 'inLap');
    expect(inLap).toBeGreaterThan(1);
    expect(spansOf(seg, ID, 3)).toEqual([
      { kind: 'pushLap', joinedAt: true, startFrame: 1, endFrame: inLap },
      { kind: 'inLap', joinedAt: undefined, startFrame: inLap, endFrame: afterLast(seg) },
    ]);
  });
  it('car 1, on its in lap, is one inLap span: the time-out sets it finished mid-lap and moves it to d 4929, no line', () => {
    expect(spansOf(seg, ID, 1)).toEqual([{ kind: 'inLap', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('no car is finished: every car set to finished at the time-out is mid-lap or in its garage (Review Focus 3)', () => {
    expect(seg.spans(ID).filter((s) => s.kind === 'finished')).toEqual([]);
  });
});
