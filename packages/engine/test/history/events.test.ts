import { describe, expect, it } from 'vitest';
import type { CarId, RaceEvent } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car = (i: number) => i as CarId;
const cases: Array<[EventDetails, Omit<RaceEvent, 'at'>]> = [
  [{ code: 'PENA', penaltyType: 4, infringementType: 7, vehicleIdx: 1, otherVehicleIdx: 255, time: 5, lapNum: 3, placesGained: 0 },
    { kind: 'penalty', carId: car(1), params: { penaltyType: 4, infringementType: 7, timeMs: 5_000, lap: 3, placesGained: 0 } }],
  [{ code: 'PENA', penaltyType: 5, infringementType: 4, vehicleIdx: 0, otherVehicleIdx: 1, time: 255, lapNum: 1, placesGained: 0 },
    { kind: 'penalty', carId: car(0), otherCarId: car(1), params: { penaltyType: 5, infringementType: 4, lap: 1, placesGained: 0 } }],
  [{ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }, { kind: 'overtake', carId: car(1), otherCarId: car(0), params: {} }],
  [{ code: 'COLL', vehicle1Idx: 0, vehicle2Idx: 1 }, { kind: 'collision', carId: car(0), otherCarId: car(1), params: {} }],
  [{ code: 'RTMT', vehicleIdx: 1, reason: 8 }, { kind: 'retirement', carId: car(1), params: { reason: 'mechanicalFailure' } }],
  [{ code: 'FTLP', vehicleIdx: 0, lapTime: 71.91000366210938 }, { kind: 'fastestLap', carId: car(0), params: { lapTimeMs: 71_910 } }],
  [{ code: 'SPTP', vehicleIdx: 1, speed: 321.5, isOverallFastestInSession: 1, isDriverFastestInSession: 0, fastestVehicleIdxInSession: 0, fastestSpeedInSession: 330.25 },
    { kind: 'speedTrap', carId: car(1), params: { speedKmh: 321.5, overallFastest: 1, driverFastest: 0, fastestCarId: 0, fastestSpeedKmh: 330.25 } }],
  [{ code: 'DRSE' }, { kind: 'drsEnabled', params: {} }],
  [{ code: 'DRSD', reason: 1 }, { kind: 'drsDisabled', params: { reason: 'safetyCar' } }],
  [{ code: 'STLG', numLights: 3 }, { kind: 'startLights', params: { lights: 3 } }],
  [{ code: 'LGOT' }, { kind: 'lightsOut', params: {} }],
];

describe('race events', () => {
  it.each(cases)('%j', (details, expected) => {
    const { st, frames, results } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).event(details).frames(1, () => {}));
    expect(st.history.events).toEqual([{ at: frames[1]!.sessionTime, ...expected }]);
    expect(results[1]!.changed.has('events')).toBe(true);
  });
  it('codes that are not race events produce none', () => {
    const b = new ScenarioBuilder({ cars: 2 }).frames(1, () => {});
    for (const d of [{ code: 'SSTA' }, { code: 'CHQF' }, { code: 'TMPT', vehicleIdx: 1 }, { code: 'RCWN', vehicleIdx: 0 }, { code: 'DTSV', vehicleIdx: 0 },
      { code: 'SGSV', vehicleIdx: 0, stopTime: 5 }, { code: 'BUTN', buttonStatus: 1 }, { code: 'SCAR', safetyCarType: 1, eventType: 0 }, { code: 'RDFL' }] as EventDetails[]) b.event(d);
    expect(runScenario(b.frames(1, () => {})).st.history.events).toEqual([]);
  });
});
