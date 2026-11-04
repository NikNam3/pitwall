// The out lap after a garage visit ends at the line on the same lap number (contract C9, C14, C17, C85; branch w2/laps,
// adapted to the timed car-activity sub-machines, migration Task 12): the garage visit of
// `test/history/laps-garage-restart.test.ts` (`GARAGE_VISIT`) through the whole engine, every sub-machine upstream of
// the activity (weekend-phase, car-location, car-status, the session phase) deciding from the frames. In practice,
// qualifying and a sprint shootout the car's activity is the push kind, the in lap, the garage, the out lap and the push
// kind again from the line where the game times the lap, though the lap number did not rise; in a race neither timed
// machine runs. That the laps recorder restarts its lap there from these spans is Task 17's.
import { describe, expect, it } from 'vitest';
import { initialState, step } from '../../../src/index.ts';
import { situationOf } from '../../../src/situations/run.ts';
import { ScenarioBuilder } from '../../builders/index.ts';
import { initFor } from '../../support/run.ts';
import { GARAGE_VISIT, garageVisitKinds } from './behaviour.ts';

const DRIVER_STATUS = { inGarage: 0, flyingLap: 1, inLap: 2, outLap: 3, onTrack: 4 } as const;
const PIT_STATUS = { none: 0, pitting: 1, inPitArea: 2 } as const;

/** Car 0's open span of `machine` after each frame of the garage visit, in a session of type `sessionType`. */
const activityOf = (sessionType: number, machine: string) => {
  const frames = new ScenarioBuilder({ cars: 1, stepMs: 1000 })
    .session({ sessionType })
    .frames(GARAGE_VISIT.length, (d) => {
      const [lap, lapDistance, currentLapTimeInMs, ps, ds] = GARAGE_VISIT[d.index]!;
      Object.assign(d.lapData.lapData[0]!, { currentLapNum: lap, lapDistance, currentLapTimeInMs, pitStatus: PIT_STATUS[ps], driverStatus: DRIVER_STATUS[ds] });
    })
    .build();
  const st = initialState(initFor(frames));
  return frames.map((frame) => {
    step(st, frame);
    return situationOf(st).byMachine[machine]?.find((s) => s.carId === 0);
  });
};

describe('the out lap after a garage visit ends at the line on the same lap number', () => {
  it.each([
    ['practice', 1, 'car-activity-practice', 'flyingLap'],
    ['qualifying', 5, 'car-activity-qualifying', 'pushLap'],
    ['a sprint shootout', 10, 'car-activity-qualifying', 'pushLap'],
  ])('in %s: the push kind, inLap, garage, outLap, then the push kind from the line (frame 11) without the lap number rising', (_, sessionType, machine, push) => {
    const spans = activityOf(sessionType, machine);
    expect(spans.map((s) => s?.kind)).toEqual(garageVisitKinds(push));
    expect(spans[11]).toMatchObject({ kind: push, startFrame: 12 });
    expect(spans[11]!.joinedAt).toBeUndefined();
  });

  it('in a race neither timed machine runs (C14)', () => {
    expect(activityOf(15, 'car-activity-practice').every((s) => s === undefined)).toBe(true);
    expect(activityOf(15, 'car-activity-qualifying').every((s) => s === undefined)).toBe(true);
  });
});
