import { carId, type CarId, type FrameEvent } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import type { StateUpdate } from './types.ts';

/** The game sends 255 for "no car". */
const NO_CAR = 255;

const carOf = (index: number): CarId | undefined => (index === NO_CAR ? undefined : carId(index));

/** The cars of an event: the one it is about and the other one, each left out where the game sends none. */
const cars = (first: number, second: number = NO_CAR): Pick<FrameEvent, 'carId' | 'otherCarId'> => {
  const car = carOf(first), other = carOf(second);
  return { ...(car !== undefined && { carId: car }), ...(other !== undefined && { otherCarId: other }) };
};

/** The value an event of the frame is (OVTK, COLL, FTLP, SPTP); a signal (C12) or BUTN gives `undefined`. */
const frameEventOf = (details: EventDetails): FrameEvent | undefined => {
  switch (details.code) {
    case 'OVTK':
      return { kind: 'overtake', ...cars(details.overtakingVehicleIdx, details.beingOvertakenVehicleIdx), params: {} };
    case 'COLL':
      return { kind: 'collision', ...cars(details.vehicle1Idx, details.vehicle2Idx), params: {} };
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
    default:
      return undefined;
  }
};

/** The frame's value events (C8), in arrival order: they belong to their frame, so every frame writes its own list. */
export const frameEventsUpdate: StateUpdate = {
  id: 'frameEvents',
  apply(frame, live) {
    live.frameEvents = frame.events.flatMap(({ details }) => frameEventOf(details) ?? []);
  },
};
