// The pit-stops recorder on a committed segment (contract C10, C26, C84; migration Task 17, rulings 1, 2, 8; facts in
// fixtures/index.json and docs/research/09-situations-inventory.md §2.7): race-drive-through-served (MiR 1631-1639.2 s),
// the player (car 19) in the pit lane past its box on its drive-through visit, which stopped in the box (the pit stop
// timer reads the stationary time), the pit exit at 1631.735 and the DTSV 7.1 s later. Every expected frame and value is
// read from the segment's own signals and values, never a fact of the recording. The tyres were changed before the
// segment begins, so the stint change of this visit is pinned on scripted frames (stints-pit-stops.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PitStatus, PitStopRecord } from '@pitwall/domain';
import type { StepResult } from '../../src/index.ts';
import { replaySegment, type SegmentRun } from '../support/segment-run.ts';

const CAR = 19;
type Seen = { pit: PitStatus; stopTimerMs: number; served: boolean; stops: PitStopRecord[] };
const seenOf = (state: StepResult['state']): Seen => ({
  pit: state.signals.cars[CAR]!.pitStatus,
  stopTimerMs: state.cars[CAR]!.timing.pitStopTimerMs,
  served: state.signals.events.some((e) => e.code === 'DTSV' && 'carId' in e && e.carId === CAR),
  stops: state.history.pitStops.filter((p) => p.carId === CAR).map((p) => ({ ...p })),
});

describe('pit stops: race-drive-through-served (MiR: the drive-through visit stopped in the box; pit exit 1631.735, DTSV 1638.850)', () => {
  let seg: SegmentRun<Seen>;
  beforeAll(async () => {
    seg = await replaySegment('race-drive-through-served.pwrec.gz', seenOf);
  });
  const firstFrame = (test: (seen: Seen) => boolean): number => seg.frames.find((f) => test(f.value))!.frameNumber;

  it('the visit is one pit stop of car 19, served, describing the pit exit frame and recorded on the DTSV frame', () => {
    const exit = firstFrame((v) => v.pit === 'none');
    const served = firstFrame((v) => v.served);
    expect(exit < served).toBe(true);
    // the pit stop timer the segment shows on the frames before the exit: the stationary time of the visit
    const stationary = Math.max(...seg.frames.filter((f) => f.frameNumber < exit).map((f) => f.value.stopTimerMs));
    expect(stationary).toBeGreaterThan(0);
    expect(seg.frames.at(-1)!.value.stops).toMatchObject([{ carId: CAR, penaltyServed: true, frame: exit, stationaryTimeMs: stationary }]);
    // nothing is recorded at the exit; the record comes once the DTSV confirms the penalty served (C18, C26)
    expect(firstFrame((v) => v.stops.length > 0)).toBe(served);
  });
});
