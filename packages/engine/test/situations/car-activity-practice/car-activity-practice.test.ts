// The practice car-activity sub-machine (contract C3, C9, C14, C15, C17, C18, C19, C26, C85): per car, what it is doing
// by practice's rules (out lap, flying lap, in lap, garage, finished, not competing), for the practice phase; its spans
// declared in domain (`carActivityPracticeSpans`). The rules and transition rows: `car-activity-timed/rows.ts`
// (car-activity-practice.transitions.ts); the shared behaviour: `car-activity-timed/behaviour.ts`. Segment (its first
// frame carries Participants): the player leaving the garage through the pit lane onto the track while an AI car ends
// its out lap at the line (practice-garage-exit, MiP 640.5-651 s).
import { beforeAll, describe, expect, it } from 'vitest';
import { carActivityPracticeSpans } from '@pitwall/domain';
import machine from '../../../src/situations/car-activity-practice/machine.ts';
import { describeTimedActivity } from '../car-activity-timed/behaviour.ts';
import { afterLast, firstFrame, replayCars, spansOf, type Seen } from '../car-activity-timed/segments.ts';
import { practice } from './car-activity-practice.transitions.ts';

const ID = 'car-activity-practice';

describeTimedActivity({ machine, spans: carActivityPracticeSpans, phase: 'practice', sessionPhaseId: 'session-phase-practice', push: 'flyingLap', t: practice });

describe('car-activity-practice: practice-garage-exit (MiP 640.5-651 s: the player leaves the garage at 641.422, exits the pit lane at 649.872)', () => {
  let seg: Seen;
  beforeAll(async () => {
    seg = await replayCars('practice-garage-exit.pwrec.gz');
  });
  it('car 19 is garage (joined), then outLap from the frame it leaves the garage, through the pit exit, to the end', () => {
    const leaves = firstFrame(seg, 19, (c) => c.ds === 'outLap');
    const exits = firstFrame(seg, 19, (c) => c.ps === 'none');
    expect(1 < leaves && leaves < exits).toBe(true);
    expect(spansOf(seg, ID, 19)).toEqual([
      { kind: 'garage', joinedAt: true, startFrame: 1, endFrame: leaves },
      { kind: 'outLap', joinedAt: undefined, startFrame: leaves, endFrame: afterLast(seg) },
    ]);
  });
  it('car 2 is outLap (joined, before the line) until the frame its lap distance reaches 0 (645.636), then flyingLap', () => {
    const line = firstFrame(seg, 2, (c) => c.d >= 0);
    expect(line).toBeGreaterThan(1);
    expect(spansOf(seg, ID, 2)).toEqual([
      { kind: 'outLap', joinedAt: true, startFrame: 1, endFrame: line },
      { kind: 'flyingLap', joinedAt: undefined, startFrame: line, endFrame: afterLast(seg) },
    ]);
  });
  it('cars 6 and 7, in their garage boxes for the whole segment, are one garage span each', () => {
    for (const index of [6, 7]) expect(spansOf(seg, ID, index)).toEqual([{ kind: 'garage', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('slots 20 and 21, which no car of the session holds, are one notCompeting span each', () => {
    for (const index of [20, 21]) expect(spansOf(seg, ID, index)).toEqual([{ kind: 'notCompeting', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('the qualifying machine has no span in practice (C14)', () => {
    expect(seg.spans('car-activity-qualifying')).toEqual([]);
  });
});
