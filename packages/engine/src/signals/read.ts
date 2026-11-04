// Step 1's reading of the signals (contract C8, C12): every field and event of the closed list, from the frame's
// packets into domain units. The machine reads what it returns (C9, C13); step 1 may read the signals it writes, to
// shape the values it writes; it decides no situation (C8).
import { carId, MAX_CARS, toSessionTime, type CarId, type NeutralisedStage } from '@pitwall/domain';
import type { EventDetails, SessionPacket } from '@pitwall/protocol';
import type { Frame } from '../frame/frame.ts';
import { pick } from '../step/pick.ts';
import { marshalZonesOf, SAFETY_CAR_STATUS, ZONE_FLAG } from '../step/state-update/session.ts';
import { DRIVER_STATUS, PIT_STATUS, RESULT_STATUS } from '../step/state-update/timing.ts';
import type { CarSignals, DrsDisabledReason, RetirementReason, SessionSignals, Signals, SituationEvent } from './types.ts';

// Code tables from the Event packet of the spec; a code the spec does not list reads as the first entry.
const RETIREMENT_REASONS = [
  'invalid',
  'retired',
  'finished',
  'terminalDamage',
  'inactive',
  'notEnoughLapsCompleted',
  'blackFlagged',
  'redFlagged',
  'mechanicalFailure',
  'sessionSkipped',
  'sessionSimulated',
] as const satisfies readonly RetirementReason[];
const DRS_DISABLED_REASONS = ['wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached'] as const satisfies readonly DrsDisabledReason[];
/** Indexed by the SCAR `safetyCarType`. */
const SAFETY_CAR_TYPE = ['none', 'SC', 'VSC', 'formation'] as const;
/** Indexed by the SCAR `eventType`. */
const SAFETY_CAR_STAGE = ['deployed', 'returning', 'returned', 'resume'] as const satisfies readonly NeutralisedStage[];

/** The game sends 255 for "no car" and, in PENA, for "no time". */
const NONE = 255;

const carOf = (index: number): CarId | undefined => (index === NONE ? undefined : carId(index));

/** A car's signals before any packet: as the car state assumes them (`createCarState`). */
const initialCarSignals = (): CarSignals => ({
  pitStatus: 'none',
  driverStatus: 'inGarage',
  pitLaneTimerActive: false,
  resultStatus: 'active',
  numPitStops: 0,
  shouldServePenalty: false,
  unservedDriveThroughs: 0,
  unservedStopGos: 0,
  timePenaltyMs: 0,
  totalWarnings: 0,
  cornerCuttingWarnings: 0,
  currentLapInvalid: false,
  fiaFlag: 'unknown',
  drsAllowed: false,
  networkPaused: false,
  aiControlled: true,
});

const sessionSignalsOf = (p: SessionPacket, numActiveCars: number): SessionSignals => ({
  safetyCarStatus: pick(SAFETY_CAR_STATUS, p.safetyCarStatus),
  marshalZones: marshalZonesOf(p),
  periods: { sc: p.numSafetyCarPeriods, vsc: p.numVirtualSafetyCarPeriods, red: p.numRedFlagPeriods },
  sessionType: p.sessionType,
  weekendStructure: p.weekendStructure.slice(0, p.numSessionsInWeekend),
  ruleSet: p.ruleSet,
  gamePaused: p.gamePaused === 1,
  isSpectating: p.isSpectating === 1,
  spectatorCarIndex: carOf(p.spectatorCarIndex),
  numActiveCars,
});

/** The signals at the start of a session: the first Session packet's, and every car's as before its first packet. */
export const initialSignals = (session: SessionPacket): Signals => ({
  cars: Array.from({ length: MAX_CARS }, initialCarSignals),
  session: sessionSignalsOf(session, 0),
  events: [],
});

/** The C12 event a game event is; the values (OVTK, COLL, FTLP, SPTP) and BUTN give `undefined`. */
const situationEventOf = (details: EventDetails): SituationEvent | undefined => {
  switch (details.code) {
    case 'SSTA':
    case 'SEND':
    case 'CHQF':
    case 'LGOT':
    case 'RDFL':
    case 'DRSE':
      return { code: details.code };
    case 'DRSD':
      return { code: 'DRSD', reason: pick(DRS_DISABLED_REASONS, details.reason, 'unknown') };
    case 'STLG':
      return { code: 'STLG', lights: details.numLights };
    case 'SCAR':
      return { code: 'SCAR', car: pick(SAFETY_CAR_TYPE, details.safetyCarType), stage: pick(SAFETY_CAR_STAGE, details.eventType) };
    case 'RCWN':
    case 'DTSV':
    case 'TMPT':
      return { code: details.code, carId: carOf(details.vehicleIdx) };
    case 'RTMT':
      return { code: 'RTMT', carId: carOf(details.vehicleIdx), reason: pick(RETIREMENT_REASONS, details.reason) };
    case 'PENA':
      return {
        code: 'PENA',
        carId: carOf(details.vehicleIdx),
        otherCarId: carOf(details.otherVehicleIdx),
        penaltyType: details.penaltyType,
        infringementType: details.infringementType,
        timeMs: details.time === NONE ? undefined : details.time * 1000,
        lap: details.lapNum,
        placesGained: details.placesGained,
      };
    case 'SGSV':
      return { code: 'SGSV', carId: carOf(details.vehicleIdx), stopTimeMs: Math.round(details.stopTime * 1000) };
    case 'FLBK':
      return { code: 'FLBK', targetFrameId: details.flashbackFrameIdentifier, targetSessionTime: toSessionTime(details.flashbackSessionTime) };
    default:
      return undefined;
  }
};

/** A car's signals with what the frame's LapData, Car Status and Participants send for it. */
const carSignalsOf = (frame: Frame, index: number, prev: CarSignals): CarSignals => {
  const l = frame.lapData?.lapData[index];
  const s = frame.status?.carStatusData[index];
  const p = frame.participants?.participants[index];
  return {
    ...prev,
    ...(l && {
      pitStatus: pick(PIT_STATUS, l.pitStatus),
      driverStatus: pick(DRIVER_STATUS, l.driverStatus),
      pitLaneTimerActive: l.pitLaneTimerActive === 1,
      resultStatus: pick(RESULT_STATUS, l.resultStatus),
      numPitStops: l.numPitStops,
      shouldServePenalty: l.pitStopShouldServePen === 1,
      unservedDriveThroughs: l.numUnservedDriveThroughPens,
      unservedStopGos: l.numUnservedStopGoPens,
      timePenaltyMs: l.penalties * 1000,
      totalWarnings: l.totalWarnings,
      cornerCuttingWarnings: l.cornerCuttingWarnings,
      currentLapInvalid: l.currentLapInvalid === 1,
    }),
    // The game sends -1 for an unknown flag, then 0 none, 1 green, 2 blue, 3 yellow.
    ...(s && { fiaFlag: pick(ZONE_FLAG, s.vehicleFiaFlags + 1), drsAllowed: s.drsAllowed === 1, networkPaused: s.networkPaused === 1 }),
    ...(p && { aiControlled: p.aiControlled === 1 }),
  };
};

/**
 * The signals after `frame`: what its Session, Participants, LapData and Car Status packets send, the rest as in `prev`;
 * the events are the frame's own, in arrival order.
 */
export const readSignals = (frame: Frame, prev: Signals): Signals => {
  const { session, participants, lapData, status } = frame;
  const numActiveCars = participants?.numActiveCars ?? prev.session.numActiveCars;
  return {
    cars: lapData || status || participants ? prev.cars.map((car, i) => carSignalsOf(frame, i, car)) : prev.cars,
    session: session ? sessionSignalsOf(session, numActiveCars) : participants ? { ...prev.session, numActiveCars } : prev.session,
    events: frame.events.flatMap(({ details }) => situationEventOf(details) ?? []),
  };
};
