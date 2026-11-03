import { MAX_CARS, type Ms, type PitStatus, type SessionState, type SessionTime } from '@pitwall/domain';
import type { Recorder } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';
import { pitLaneStep } from './pit-lane.ts';
import { initialRaceStartMark, raceStartStep, type RaceStartMark } from './race-start.ts';

/** A pit visit in progress, until it becomes a `PitStopRecord`. */
export type OpenPitVisit = {
  lap: number;
  entry: SessionTime;
  flag: 'green' | 'sc' | 'vsc';
  penaltyServed: boolean;
  pitLaneTimeMs: Ms;
  stationaryTimeMs: Ms;
};

/** The pit-stop recorder's own open state (C10); per-car arrays are indexed by `CarId`. */
export type PitStopsOwn = {
  /** Per car: the pit status of the previous LapData frame. */
  pitStatus: Array<PitStatus | undefined>;
  visits: Array<OpenPitVisit | undefined>;
  /** Where the race start is (its own copy, C11). */
  raceStart: RaceStartMark;
};

const flagOf = (flag: SessionState['flag']): OpenPitVisit['flag'] => (flag === 'sc' || flag === 'vsc' ? flag : 'green');

/**
 * A pit visit runs from an observed change of the pit status away from `none` to the change back (`pitLaneStep`).
 * Leaving the garage (the first status seen is already not `none`) is no visit, and neither is a pit-lane start: at the
 * race start (`raceStartStep`) no visit goes on, as a car in the pit lane then starts the race from it (review 2 B4). A
 * drive-through or stop-go served during the visit (step 2's `tracked.penaltyServed`) marks it.
 */
export const pitStopsRecorder: Recorder<PitStopsOwn> = {
  id: 'pitStops',
  init: () => ({
    pitStatus: Array.from({ length: MAX_CARS }, () => undefined),
    visits: Array.from({ length: MAX_CARS }, () => undefined),
    raceStart: initialRaceStartMark(),
  }),
  apply(input, own, log, out) {
    const { at, live } = input;
    const start = raceStartStep(own.raceStart, input.situation);
    own.raceStart = start.mark;
    if (start.started) own.visits.fill(undefined);
    for (const carId of input.tracked?.penaltyServed ?? []) {
      const visit = own.visits[carId];
      if (visit) visit.penaltyServed = true;
    }
    for (const car of carsWithLapData(input)) {
      const { pitStatus, pitLaneTimeMs, pitStopTimerMs, lap } = car.timing;
      const previous = own.pitStatus[car.id];
      own.pitStatus[car.id] = pitStatus;
      const visitBefore = own.visits[car.id];
      const pit = pitLaneStep(previous && { status: previous, ...(visitBefore && { visitLap: visitBefore.lap }) }, pitStatus, lap);
      if (pit.entered) {
        own.visits[car.id] = { lap, entry: at, flag: flagOf(live.session.flag), penaltyServed: false, pitLaneTimeMs: 0, stationaryTimeMs: 0 };
      }
      const visit = own.visits[car.id];
      if (!visit) continue;
      visit.pitLaneTimeMs = Math.max(visit.pitLaneTimeMs, pitLaneTimeMs);
      visit.stationaryTimeMs = Math.max(visit.stationaryTimeMs, pitStopTimerMs);
      if (!pit.left) continue;
      log.append('pitStops', {
        carId: car.id,
        lap: visit.lap,
        pitLaneEntry: visit.entry,
        pitLaneExit: at,
        // The game's pit lane timer, or the observed duration when it never ran.
        pitLaneTimeMs: visit.pitLaneTimeMs > 0 ? visit.pitLaneTimeMs : at - visit.entry,
        stationaryTimeMs: visit.stationaryTimeMs,
        flag: visit.flag,
        penaltyServed: visit.penaltyServed,
        frame: input.frameNumber,
      });
      own.visits[car.id] = undefined;
      out.changed.add('pitStops');
    }
    return own;
  },
};
