// trackLength 5000 m → 50 segments of 100 m; frames every 100 ms
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const crossings = (samples: ReadonlyArray<readonly [lap: number, distance: number]>, o: { resultStatus?: number } = {}) => {
  const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 100 }).frames(samples.length, (d) => {
    Object.assign(d.lapData.lapData[0]!, { currentLapNum: samples[d.index]![0], lapDistance: samples[d.index]![1], resultStatus: o.resultStatus ?? 2 });
  }));
  return st.history.miniSectors.map(({ carId, lap, segment, at }) => ({ carId, lap, segment, at }));
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
