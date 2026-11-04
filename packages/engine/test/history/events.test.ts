// The events recorder (contract C10, C12, C13, C26; migration Task 21): `events` holds the frame's value events
// (overtake, collision, fastest lap, speed trap, from `live.frameEvents`) and the damage changes, never a situation
// event. PENA, RTMT, DRSE, DRSD, STLG and LGOT are signals (C12): the machine reads them (step 1 may read the signals it
// writes, to shape the values it writes; it decides no situation, C8), and they reach readers as spans (C13, C20; penalties, car-status, race-control, session-phase), never as `RaceEvent`s. Ported from the race
// events cases of before Task 21: the situation events' rows moved to "situation events never become RaceEvents".
import { describe, expect, it } from 'vitest';
import type { CarId, RaceEvent } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car = (i: number) => i as CarId;
// Each event comes on frame 1, the session's second applied frame: it describes frame number 2 (C26).
const cases: Array<[EventDetails, Omit<RaceEvent, 'at'>]> = [
  [{ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }, { kind: 'overtake', carId: car(1), otherCarId: car(0), params: {}, frame: 2 }],
  [{ code: 'COLL', vehicle1Idx: 0, vehicle2Idx: 1 }, { kind: 'collision', carId: car(0), otherCarId: car(1), params: {}, frame: 2 }],
  [{ code: 'FTLP', vehicleIdx: 0, lapTime: 71.91000366210938 }, { kind: 'fastestLap', carId: car(0), params: { lapTimeMs: 71_910 }, frame: 2 }],
  [{ code: 'SPTP', vehicleIdx: 1, speed: 321.5, isOverallFastestInSession: 1, isDriverFastestInSession: 0, fastestVehicleIdxInSession: 0, fastestSpeedInSession: 330.25 },
    { kind: 'speedTrap', carId: car(1), params: { speedKmh: 321.5, overallFastest: 1, driverFastest: 0, fastestCarId: 0, fastestSpeedKmh: 330.25 }, frame: 2 }],
];

/** The situation events of C12 that were recorded as race events before Task 21, each as the game sends it. */
const SITUATION_EVENTS: EventDetails[] = [
  { code: 'PENA', penaltyType: 4, infringementType: 7, vehicleIdx: 1, otherVehicleIdx: 255, time: 5, lapNum: 3, placesGained: 0 },
  { code: 'PENA', penaltyType: 5, infringementType: 4, vehicleIdx: 0, otherVehicleIdx: 1, time: 255, lapNum: 1, placesGained: 0 },
  { code: 'PENA', penaltyType: 0, infringementType: 38, vehicleIdx: 0, otherVehicleIdx: 255, time: 255, lapNum: 2, placesGained: 0 },
  { code: 'RTMT', vehicleIdx: 1, reason: 8 },
  { code: 'DRSE' },
  { code: 'DRSD', reason: 0 },
  { code: 'DRSD', reason: 3 },
  { code: 'DRSD', reason: 255 },
  { code: 'STLG', numLights: 3 },
  { code: 'LGOT' },
];

describe('race events', () => {
  it.each(cases)('%j', (details, expected) => {
    const { st, frames, results } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).event(details).frames(1, () => {}));
    expect(st.history.events).toEqual([{ at: frames[1]!.sessionTime, ...expected }]);
    expect(results[1]!.changed.has('events')).toBe(true);
  });
  it.each(SITUATION_EVENTS)('situation events never become RaceEvents: %j records no event, in the log or the projection (C12, C13)', (details) => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).event(details).frames(1, () => {}));
    expect([st.log.events, st.history.events]).toEqual([[], []]);
    expect(results[1]!.changed.has('events')).toBe(false);
  });
  it('situation events never become RaceEvents: all of them on one frame, with an overtake, record the overtake only', () => {
    const b = new ScenarioBuilder({ cars: 2 }).frames(1, () => {});
    for (const d of SITUATION_EVENTS) b.event(d);
    const { st } = runScenario(b.event({ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }).frames(1, () => {}));
    expect(st.log.events.map((e) => e.kind)).toEqual(['overtake']);
  });
  it('codes that are not race events produce none', () => {
    const b = new ScenarioBuilder({ cars: 2 }).frames(1, () => {});
    for (const d of [{ code: 'SSTA' }, { code: 'CHQF' }, { code: 'TMPT', vehicleIdx: 1 }, { code: 'RCWN', vehicleIdx: 0 }, { code: 'DTSV', vehicleIdx: 0 },
      { code: 'SGSV', vehicleIdx: 0, stopTime: 5 }, { code: 'BUTN', buttonStatus: 1 }, { code: 'SCAR', safetyCarType: 1, eventType: 0 }, { code: 'RDFL' }] as EventDetails[]) b.event(d);
    expect(runScenario(b.frames(1, () => {})).st.history.events).toEqual([]);
  });
});
