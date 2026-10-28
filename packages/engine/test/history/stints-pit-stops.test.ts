import { describe, expect, it } from 'vitest';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const OLD = { actualTyreCompound: 18, visualTyreCompound: 17, tyresAgeLaps: 3 }, NEW = { actualTyreCompound: 19, visualTyreCompound: 18, tyresAgeLaps: 0 };

describe('stints', () => {
  it.each([
    ['line in the pit lane before the box', [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [5, 1, 0], [6, 1, 0], [6, 2, 1], [6, 0, 1], [7, 0, 1]]],
    ['box before the line', [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [5, 1, 0], [5, 2, 1], [6, 1, 1], [6, 0, 1], [7, 0, 1]]],
  ] as const)('closes on a tyre change (%s); SEND closes the open stint', (_, seq) => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      const [lap, pitStatus, fresh] = seq[d.index]!;
      Object.assign(car0(d), { currentLapNum: lap, pitStatus, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, fresh ? NEW : OLD);
    }).event({ code: 'SEND' }));                                                  // attaches to the last frame (Task 11)
    expect(st.history.stints).toEqual([
      { carId: 0, firstLap: 1, lastLap: 5, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3 },
      { carId: 0, firstLap: 6, lastLap: 6, actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtFitting: 0 }]);
    expect(results.filter((r) => r.changed.has('stints'))).toHaveLength(2);
  });
  it('a fresh set of the same compound (age drops) also starts a new stint', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      Object.assign(car0(d), { currentLapNum: 4 + d.index, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, { ...OLD, tyresAgeLaps: d.index === 0 ? 7 : 0 });
    }));
    expect(st.history.stints).toMatchObject([{ firstLap: 4, lastLap: 4, tyreAgeAtFitting: 7 }]);
  });
});

describe('pit stops', () => {
  const steps = [{ currentLapNum: 5 }, { pitStatus: 1, pitLaneTimerActive: 1, pitLaneTimeInLaneInMs: 0 },
    { pitStatus: 2, pitLaneTimeInLaneInMs: 9_000, pitStopTimerInMs: 1_200 }, { pitStopTimerInMs: 2_400, pitLaneTimeInLaneInMs: 10_000 },
    { pitStatus: 1, pitLaneTimeInLaneInMs: 21_800 }, { pitStatus: 0, pitLaneTimerActive: 0, pitLaneTimeInLaneInMs: 0 }];
  const script = (d: FrameDraft) => { Object.assign(car0(d), steps[d.index]); };
  const stop = (o: { sc?: boolean; served?: boolean } = {}) => {            // t = 0, 6000 (entry), …, 30000 (exit)
    const b = new ScenarioBuilder({ cars: 1, stepMs: 6000 }).frames(1, script);
    if (o.sc) b.session({ safetyCarStatus: 1 });
    b.frames(2, script);
    if (o.served) b.event({ code: 'DTSV', vehicleIdx: 0 });
    return runScenario(b.frames(3, script));
  };
  it('records entry, exit, the game’s pit-lane time and the stationary time', () => {
    const { st, results } = stop();
    expect(st.history.pitStops).toEqual([{ carId: 0, lap: 5, pitLaneEntry: 6_000, pitLaneExit: 30_000, pitLaneTimeMs: 21_800,
      stationaryTimeMs: 2_400, flag: 'green', penaltyServed: false }]);
    expect(results[5]!.changed.has('pitStops')).toBe(true);
  });
  it('takes the flag at pit entry and marks a served penalty (DTSV/SGSV)', () => {
    expect(stop({ sc: true, served: true }).st.history.pitStops[0]).toMatchObject({ flag: 'sc', penaltyServed: true });
  });
  it('leaving the garage is not a pit stop', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => { car0(d).pitStatus = d.index === 0 ? 2 : 0; }));
    expect(st.history.pitStops).toEqual([]);
  });
});
