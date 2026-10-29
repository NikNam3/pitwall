import { carId, type RaceEvent } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import { applyDamageChanges } from './damage-changes.ts';
import { pick } from '../step/pick.ts';
import type { SubStep } from '../step/types.ts';

// Code tables from the Event packet of the spec.
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
] as const;
const DRS_DISABLED_REASONS = ['wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached'] as const;

/** The game sends 255 for "no car" and for "no value" in the penalty time. */
const NONE = 255;

type EventBody = Omit<RaceEvent, 'at'>;

const cars = (first: number, second: number = NONE): Pick<EventBody, 'carId' | 'otherCarId'> => ({
  ...(first !== NONE && { carId: carId(first) }),
  ...(second !== NONE && { otherCarId: carId(second) }),
});

/** The race event a game event stands for; the events that are no part of the race history give `undefined`. */
const raceEventOf = (details: EventDetails): EventBody | undefined => {
  switch (details.code) {
    case 'PENA':
      return {
        kind: 'penalty',
        ...cars(details.vehicleIdx, details.otherVehicleIdx),
        params: {
          penaltyType: details.penaltyType,
          infringementType: details.infringementType,
          ...(details.time !== NONE && { timeMs: details.time * 1000 }),
          lap: details.lapNum,
          placesGained: details.placesGained,
        },
      };
    case 'OVTK':
      return { kind: 'overtake', ...cars(details.overtakingVehicleIdx, details.beingOvertakenVehicleIdx), params: {} };
    case 'COLL':
      return { kind: 'collision', ...cars(details.vehicle1Idx, details.vehicle2Idx), params: {} };
    case 'RTMT':
      return { kind: 'retirement', ...cars(details.vehicleIdx), params: { reason: pick(RETIREMENT_REASONS, details.reason) } };
    case 'FTLP':
      return { kind: 'fastestLap', ...cars(details.vehicleIdx), params: { lapTimeMs: Math.round(details.lapTime * 1000) } };
    case 'SPTP':
      return {
        kind: 'speedTrap',
        ...cars(details.vehicleIdx),
        params: {
          speedKmh: details.speed,
          overallFastest: details.isOverallFastestInSession,
          driverFastest: details.isDriverFastestInSession,
          fastestCarId: details.fastestVehicleIdxInSession,
          fastestSpeedKmh: details.fastestSpeedInSession,
        },
      };
    case 'DRSE':
      return { kind: 'drsEnabled', params: {} };
    case 'DRSD':
      return { kind: 'drsDisabled', params: { reason: pick(DRS_DISABLED_REASONS, details.reason) } };
    case 'STLG':
      return { kind: 'startLights', params: { lights: details.numLights } };
    case 'LGOT':
      return { kind: 'lightsOut', params: {} };
    default:
      return undefined;
  }
};

/** The game's events that belong to the race history, in the order they arrived. */
export const applyEvents: SubStep = (state, frame, out) => {
  const before = state.history.events.length;
  for (const { details } of frame.events) {
    const body = raceEventOf(details);
    if (body) state.history.events.push({ at: frame.sessionTime, ...body });
  }
  applyDamageChanges(state, frame);
  if (state.history.events.length > before) out.changed.add('events');
};
