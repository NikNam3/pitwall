// C12, C13: every signal of the closed list reaches `Signals`, in domain units (ms, `CarId | undefined`, the session
// time in ms), and nothing else does: OVTK, COLL, FTLP and SPTP are values (`FrameEvent`), BUTN is ignored.
import { describe, expect, it } from 'vitest';
import { carId } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import { initialState, step, type Frame } from '../../src/index.ts';
import { readSignals } from '../../src/signals/read.ts';
import type { SignalKey, Signals, SituationEvent } from '../../src/signals/types.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

/** The car whose LapData, Car Status and Participants entries carry non-default values. */
const CAR = 3;

/** One frame carrying a Session, a Participants, a LapData and a Car Status packet with a non-default value for every signal. */
const signalFrame = (): Frame =>
  new ScenarioBuilder({ cars: 6 })
    .session({
      safetyCarStatus: 2,
      numMarshalZones: 2,
      marshalZones: { 0: { zoneStart: 0.25, zoneFlag: 3 }, 1: { zoneStart: 0.5, zoneFlag: 1 } },
      numSafetyCarPeriods: 1,
      numVirtualSafetyCarPeriods: 2,
      numRedFlagPeriods: 3,
      sessionType: 16,
      numSessionsInWeekend: 2,
      weekendStructure: { 0: 15, 1: 16, 2: 9 },
      ruleSet: 1,
      gamePaused: 1,
      isSpectating: 1,
      spectatorCarIndex: 4,
    })
    .participants({ numActiveCars: 5, participants: { [CAR]: { aiControlled: 0 } } })
    .frame((d) => {
      Object.assign(d.lapData.lapData[CAR]!, {
        pitStatus: 2,
        driverStatus: 3,
        pitLaneTimerActive: 1,
        resultStatus: 3,
        numPitStops: 2,
        pitStopShouldServePen: 1,
        numUnservedDriveThroughPens: 1,
        numUnservedStopGoPens: 2,
        penalties: 5,
        totalWarnings: 3,
        cornerCuttingWarnings: 2,
        currentLapInvalid: 1,
      });
      Object.assign(d.status.carStatusData[CAR]!, { vehicleFiaFlags: 3, drsAllowed: 1, networkPaused: 1 });
    })
    .build()[0]!;

/** The signals before any frame: the initial state's. */
const initialSignals = (frame: Frame): Signals => initialState(initFor([frame])).signals;

const signalsOf = (frame: Frame): Signals => readSignals(frame, initialSignals(frame));

/** Every field signal of C12 (all but the events): how to read it from `Signals`, and its value for `signalFrame`. */
const FIELDS: { [K in Exclude<SignalKey, 'events'>]: readonly [read: (s: Signals) => unknown, expected: unknown] } = {
  pitStatus: [(s) => s.cars[CAR]!.pitStatus, 'inPitArea'],
  driverStatus: [(s) => s.cars[CAR]!.driverStatus, 'outLap'],
  pitLaneTimerActive: [(s) => s.cars[CAR]!.pitLaneTimerActive, true],
  resultStatus: [(s) => s.cars[CAR]!.resultStatus, 'finished'],
  numPitStops: [(s) => s.cars[CAR]!.numPitStops, 2],
  shouldServePenalty: [(s) => s.cars[CAR]!.shouldServePenalty, true],
  unservedDriveThroughs: [(s) => s.cars[CAR]!.unservedDriveThroughs, 1],
  unservedStopGos: [(s) => s.cars[CAR]!.unservedStopGos, 2],
  timePenaltyMs: [(s) => s.cars[CAR]!.timePenaltyMs, 5000],
  totalWarnings: [(s) => s.cars[CAR]!.totalWarnings, 3],
  cornerCuttingWarnings: [(s) => s.cars[CAR]!.cornerCuttingWarnings, 2],
  currentLapInvalid: [(s) => s.cars[CAR]!.currentLapInvalid, true],
  fiaFlag: [(s) => s.cars[CAR]!.fiaFlag, 'yellow'],
  drsAllowed: [(s) => s.cars[CAR]!.drsAllowed, true],
  networkPaused: [(s) => s.cars[CAR]!.networkPaused, true],
  // car 3 is set to a human, car 2 keeps the builder's AI
  aiControlled: [(s) => [s.cars[CAR]!.aiControlled, s.cars[2]!.aiControlled], [false, true]],
  safetyCarStatus: [(s) => s.session.safetyCarStatus, 'vsc'],
  marshalZones: [(s) => s.session.marshalZones, [{ startFraction: 0.25, flag: 'yellow' }, { startFraction: 0.5, flag: 'green' }]],
  periods: [(s) => s.session.periods, { sc: 1, vsc: 2, red: 3 }],
  sessionType: [(s) => s.session.sessionType, 16],
  // as long as numSessionsInWeekend
  weekendStructure: [(s) => s.session.weekendStructure, [15, 16]],
  ruleSet: [(s) => s.session.ruleSet, 1],
  gamePaused: [(s) => s.session.gamePaused, true],
  isSpectating: [(s) => s.session.isSpectating, true],
  spectatorCarIndex: [(s) => s.session.spectatorCarIndex, 4],
  numActiveCars: [(s) => s.session.numActiveCars, 5],
};

describe('readSignals: every C12 field and event reaches Signals', () => {
  it.each(Object.entries(FIELDS))('%s', (_, [read, expected]) => {
    expect(read(signalsOf(signalFrame()))).toEqual(expected);
  });

  it('spectatorCarIndex 255 (no spectated car) is undefined', () => {
    const frame = new ScenarioBuilder({ cars: 6 }).session({ spectatorCarIndex: 255 }).frame(() => {}).build()[0]!;
    expect(signalsOf(frame).session.spectatorCarIndex).toBeUndefined();
  });

  /** A frame of a 6-car session that carries the event. */
  const eventFrame = (details: EventDetails): Frame => new ScenarioBuilder({ cars: 6 }).event(details).frame(() => {}).build()[0]!;

  /** Every C12 event: the game's event and the `SituationEvent` it becomes. */
  const EVENTS: { [C in SituationEvent['code']]: readonly [EventDetails, Extract<SituationEvent, { code: C }>] } = {
    SSTA: [{ code: 'SSTA' }, { code: 'SSTA' }],
    SEND: [{ code: 'SEND' }, { code: 'SEND' }],
    CHQF: [{ code: 'CHQF' }, { code: 'CHQF' }],
    LGOT: [{ code: 'LGOT' }, { code: 'LGOT' }],
    RDFL: [{ code: 'RDFL' }, { code: 'RDFL' }],
    DRSE: [{ code: 'DRSE' }, { code: 'DRSE' }],
    DRSD: [{ code: 'DRSD', reason: 1 }, { code: 'DRSD', reason: 'safetyCar' }],
    STLG: [{ code: 'STLG', numLights: 3 }, { code: 'STLG', lights: 3 }],
    SCAR: [{ code: 'SCAR', safetyCarType: 2, eventType: 1 }, { code: 'SCAR', car: 'VSC', stage: 'returning' }],
    RCWN: [{ code: 'RCWN', vehicleIdx: 4 }, { code: 'RCWN', carId: carId(4) }],
    RTMT: [{ code: 'RTMT', vehicleIdx: 4, reason: 8 }, { code: 'RTMT', carId: carId(4), reason: 'mechanicalFailure' }],
    PENA: [
      { code: 'PENA', penaltyType: 1, infringementType: 7, vehicleIdx: 4, otherVehicleIdx: 2, time: 5, lapNum: 3, placesGained: 1 },
      { code: 'PENA', carId: carId(4), otherCarId: carId(2), penaltyType: 1, infringementType: 7, timeMs: 5000, lap: 3, placesGained: 1 },
    ],
    DTSV: [{ code: 'DTSV', vehicleIdx: 4 }, { code: 'DTSV', carId: carId(4) }],
    SGSV: [{ code: 'SGSV', vehicleIdx: 4, stopTime: 2.5 }, { code: 'SGSV', carId: carId(4), stopTimeMs: 2500 }],
    TMPT: [{ code: 'TMPT', vehicleIdx: 4 }, { code: 'TMPT', carId: carId(4) }],
    FLBK: [
      { code: 'FLBK', flashbackFrameIdentifier: 7, flashbackSessionTime: 0.5 },
      { code: 'FLBK', targetFrameId: 7, targetSessionTime: 500 },
    ],
  };

  it.each(Object.entries(EVENTS))('the event %s', (_, [details, expected]) => {
    expect(signalsOf(eventFrame(details)).events).toEqual([expected]);
  });

  it('255 is no car and, in PENA, no time: undefined', () => {
    const pena = eventFrame({ code: 'PENA', penaltyType: 0, infringementType: 0, vehicleIdx: 255, otherVehicleIdx: 255, time: 255, lapNum: 1, placesGained: 0 });
    expect(signalsOf(pena).events).toEqual([
      { code: 'PENA', carId: undefined, otherCarId: undefined, penaltyType: 0, infringementType: 0, timeMs: undefined, lap: 1, placesGained: 0 },
    ]);
    expect(signalsOf(eventFrame({ code: 'RCWN', vehicleIdx: 255 })).events).toEqual([{ code: 'RCWN', carId: undefined }]);
  });

  it('the events of a frame keep their order', () => {
    const frame = new ScenarioBuilder({ cars: 6 }).event({ code: 'STLG', numLights: 1 }).event({ code: 'STLG', numLights: 2 }).event({ code: 'LGOT' }).frame(() => {}).build()[0]!;
    expect(signalsOf(frame).events).toEqual([{ code: 'STLG', lights: 1 }, { code: 'STLG', lights: 2 }, { code: 'LGOT' }]);
  });

  it('OVTK, COLL, FTLP and SPTP are values, BUTN is ignored: none of them is a signal', () => {
    const values: EventDetails[] = [
      { code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 2 },
      { code: 'COLL', vehicle1Idx: 1, vehicle2Idx: 2 },
      { code: 'FTLP', vehicleIdx: 1, lapTime: 80 },
      { code: 'SPTP', vehicleIdx: 1, speed: 320, isOverallFastestInSession: 1, isDriverFastestInSession: 1, fastestVehicleIdxInSession: 1, fastestSpeedInSession: 320 },
      { code: 'BUTN', buttonStatus: 1 },
    ];
    for (const details of values) expect([details.code, signalsOf(eventFrame(details)).events]).toEqual([details.code, []]);
  });

  it('a frame without those packets keeps the previous signals and has no events', () => {
    const b = new ScenarioBuilder({ cars: 6 }).session({ safetyCarStatus: 1 }).event({ code: 'SSTA' }).frame((d) => {
      d.lapData.lapData[CAR]!.numPitStops = 1;
    });
    const [first, bare] = b.frame((d) => { d.drop('lapData'); d.drop('status'); }).build();
    expect(bare!.session === undefined && bare!.participants === undefined && bare!.lapData === undefined && bare!.status === undefined).toBe(true);
    const before = signalsOf(first!);
    expect(readSignals(bare!, before)).toEqual({ ...before, events: [] });
  });
});

describe('step 1 writes the signals', () => {
  it("step leaves the frame's signals in the state", () => {
    const frame = new ScenarioBuilder({ cars: 6 }).event({ code: 'SSTA' }).frame((d) => {
      d.lapData.lapData[CAR]!.numPitStops = 2;
    }).build()[0]!;
    const st = initialState(initFor([frame]));
    step(st, frame);
    expect([st.signals.events, st.signals.cars[CAR]!.numPitStops]).toEqual([[{ code: 'SSTA' }], 2]);
  });
});
