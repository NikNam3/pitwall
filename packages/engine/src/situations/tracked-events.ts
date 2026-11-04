// Step 2's slot until the machine runs (Tasks 5-21): what the frame's situation events decide for the recorders, so no
// recorder reads a signal (C13). Each part goes with the task named on `TrackedEvents` (`step/types.ts`).
import type { CarId } from '@pitwall/domain';
import type { SituationEvent } from '../signals/types.ts';
import type { RaceEventBody, TrackedEvents } from '../step/types.ts';

/** The cars of an event, each left out where the game sends none. */
const cars = (carId: CarId | undefined, otherCarId?: CarId): Pick<RaceEventBody, 'carId' | 'otherCarId'> => ({
  ...(carId !== undefined && { carId }),
  ...(otherCarId !== undefined && { otherCarId }),
});

/** The race event a situation event is still recorded as; the others give `undefined`. */
const raceEventOf = (event: SituationEvent): RaceEventBody | undefined => {
  switch (event.code) {
    case 'PENA':
      return {
        kind: 'penalty',
        ...cars(event.carId, event.otherCarId),
        params: {
          penaltyType: event.penaltyType,
          infringementType: event.infringementType,
          ...(event.timeMs !== undefined && { timeMs: event.timeMs }),
          lap: event.lap,
          placesGained: event.placesGained,
        },
      };
    case 'RTMT':
      return { kind: 'retirement', ...cars(event.carId), params: { reason: event.reason } };
    case 'DRSE':
      return { kind: 'drsEnabled', params: {} };
    case 'DRSD':
      return { kind: 'drsDisabled', params: { reason: event.reason } };
    case 'STLG':
      return { kind: 'startLights', params: { lights: event.lights } };
    case 'LGOT':
      return { kind: 'lightsOut', params: {} };
    default:
      return undefined;
  }
};

/** What the frame's situation events (`signals.events`) tell the recorders. */
export const trackedEventsOf = (events: readonly SituationEvent[]): TrackedEvents => ({
  raceEvents: events.flatMap((e) => raceEventOf(e) ?? []),
});
