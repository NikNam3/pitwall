// trackLength 5000 m → 50 segments of 100 m; frames every 100 ms
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder } from '../builders/index.ts';
import { situationOf } from '../../src/situations/run.ts';
import { runScenario } from '../support/run.ts';

const crossings = (samples: ReadonlyArray<readonly [lap: number, distance: number]>, o: { resultStatus?: number } = {}) => {
  const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 100 }).frames(samples.length, (d) => {
    Object.assign(d.lapData.lapData[0]!, { currentLapNum: samples[d.index]![0], lapDistance: samples[d.index]![1], resultStatus: o.resultStatus ?? 2 });
  }));
  return st.history.crossings.map(({ carId, lap, segment, at }) => ({ carId, lap, segment, at }));
};

describe('mini-sector crossings', () => {
  it('first sample emits nothing; then every boundary at a linearly interpolated session time', () => {
    expect(crossings([[1, 950]])).toEqual([]);
    expect(crossings([[1, 950], [1, 1250]])).toEqual([{ carId: 0, lap: 1, segment: 10, at: 17 }, { carId: 0, lap: 1, segment: 11, at: 50 },
      { carId: 0, lap: 1, segment: 12, at: 83 }]);
  });
  it('lap wrap: the line is segment 0 of the new lap, interpolated over the wrapped distance', () => {
    expect(crossings([[3, 4950], [4, 150]])).toEqual([{ carId: 0, lap: 4, segment: 0, at: 25 }, { carId: 0, lap: 4, segment: 1, at: 75 }]);
  });
  it('crossing the line from a negative lap distance', () => {
    expect(crossings([[1, -30], [1, 20]])).toEqual([{ carId: 0, lap: 1, segment: 0, at: 60 }]);
  });
  it('never emits a crossing twice (backwards jitter, re-crossing)', () => {
    expect(crossings([[1, 1150], [1, 1250], [1, 1190], [1, 1210], [1, 1300]]).map((c) => [c.segment, c.at])).toEqual([[12, 50], [13, 400]]);
  });
  it('a lap jump > 1 or a lap going down resets the cursor without emitting', () => {
    expect(crossings([[3, 4950], [5, 100], [5, 250], [4, 300]]).map((c) => [c.lap, c.segment, c.at])).toEqual([[5, 2, 167]]);
  });
  it('inactive cars emit nothing', () => {
    expect(crossings([[1, 100], [1, 900]], { resultStatus: 1 })).toEqual([]);
  });
});

// Migration Task 21 (contract C10, C11, C26; rulings 3 and 4): the mini-sectors recorder follows the laps recorder's
// activity rule (one shared pure helper in recorders/, C11): no crossing while the car's race activity is `coolDown` or
// `notCompeting`. A finisher's final lap ends at a crossing of the line on the same lap number (the game does not raise
// it at the chequered flag; its result status turns finished on that frame or one frame later, inventory §2.10): that
// crossing is the line, segment 0 of the next lap (`(lap + 1, 0)`), interpolated over the wrapped distance like any lap
// wrap, and describes the frame the lap distance wrapped on (C26), as the final lap does (Task 17 B1).
describe('mini-sector crossings at the finish and after it (rulings 3, 4)', () => {
  /** [lap, lap distance, result status] per frame of car 0, one a second, a race under way (lap timer 30 s); 3 = finished, 7 = retired. */
  type Row = readonly [lap: number, distanceM: number, resultStatus: number];
  const race = (rows: readonly Row[], cars = 1) => runScenario(new ScenarioBuilder({ cars, stepMs: 1000 }).frames(rows.length, (d) => {
    const [currentLapNum, lapDistance, resultStatus] = rows[d.index]!;
    Object.assign(d.lapData.lapData[0]!, { currentLapNum, lapDistance, resultStatus, currentLapTimeInMs: 30_000, lastLapTimeInMs: 90_000 });
  }));
  type St = ReturnType<typeof race>['st'];
  /** Car 0's crossings readers see, with the frame each describes. */
  const ofCar0 = (st: St) => st.history.crossings.filter((c) => c.carId === 0).map(({ lap, segment, at, frame }) => ({ lap, segment, at, frame }));
  /** Car 0's race-activity spans, closed and open, as kind and the frame each opened on. */
  const activity = (st: St) => [...(st.history.spans['car-activity-race'] ?? []), ...(situationOf(st).byMachine['car-activity-race'] ?? [])]
    .filter((s) => s.carId === 0).map((s) => ({ kind: s.kind, startFrame: s.startFrame }));
  const startOf = (st: St, kind: string): number => activity(st).find((s) => s.kind === kind)!.startFrame;
  // the line at 0 m: 100 m of the 105 m from 4900 m on lap 5 to 5 m on frame 1 (number 2), so at 1000 * 100 / 105 ms
  const FINAL_LINE = { lap: 6, segment: 0, at: 952, frame: 2 };

  it('the result status finished on the crossing frame: the final line crossing (lap + 1, 0) at the wrap, and nothing in the cool-down after it', () => {
    const { st } = race([[5, 4_900, 2], [5, 5, 3], [5, 300, 3], [5, 2_500, 3], [6, 10, 3], [6, 400, 3]]);
    expect(activity(st).map((s) => s.kind)).toEqual(['racingLap', 'finished', 'coolDown']);
    expect(ofCar0(st)).toEqual([FINAL_LINE]);
  });
  it('the result status finished one frame after the crossing (race-miami-finish): the final line crossing describes the wrap frame', () => {
    const { st } = race([[5, 4_900, 2], [5, 5, 2], [5, 300, 3], [5, 2_500, 3], [6, 10, 3], [6, 400, 3]]);
    expect(activity(st).map((s) => s.kind)).toEqual(['racingLap', 'finished', 'coolDown']);
    expect(startOf(st, 'finished')).toBe(3);
    expect(ofCar0(st).filter((c) => c.segment === 0)).toEqual([FINAL_LINE]);
  });
  it('no crossing while the car’s activity is coolDown: none describes a frame of the cool-down, though the car drives on and its lap number goes up', () => {
    const { st } = race([[5, 4_900, 2], [5, 5, 2], [5, 300, 3], [5, 2_500, 3], [5, 4_990, 3], [6, 10, 3], [6, 400, 3], [6, 1_500, 3]]);
    const coolDown = startOf(st, 'coolDown');
    expect(coolDown).toBe(4);
    expect(ofCar0(st).filter((c) => c.frame >= coolDown)).toEqual([]);
  });
  it('no crossing while the car’s activity is notCompeting: a retired car that still moves records none from its notCompeting span on', () => {
    const { st } = race([[3, 1_000, 2], [3, 1_200, 2], [3, 1_500, 7], [3, 2_000, 7], [4, 10, 7], [4, 300, 7]], 2);
    const out = startOf(st, 'notCompeting');
    expect(ofCar0(st).filter((c) => c.frame < out).map((c) => [c.lap, c.segment])).toEqual([[3, 11], [3, 12]]);
    expect(ofCar0(st).filter((c) => c.frame >= out)).toEqual([]);
  });
});
