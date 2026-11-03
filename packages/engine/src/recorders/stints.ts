import { MAX_CARS, type ActualCompound, type CarId, type Stamp, type VisualCompound } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import { stampOf, type Recorder } from '../step/types.ts';
import { carsWithLapData, type LiveCar } from './cars.ts';
import { lapMarkOf, lapStepOf, markPitLane, type LapMark } from './lap-boundary.ts';
import { endVisits, pitLaneStep, type PitLane } from './pit-lane.ts';

/** The stint a car is on, until it becomes a `StintRecord`. */
export type OpenStint = {
  firstLap: number;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  tyreAgeAtFitting: number;
  lastAge: number;
};

/**
 * The stint recorder's own open state (C10); per-car arrays are indexed by `CarId`. Besides the stints, its own copies
 * of what tells the in lap (C11: not the lap and pit-stop recorders' state; Task 17's activity spans replace them).
 */
export type StintsOwn = {
  stints: Array<OpenStint | undefined>;
  /** Per car: the pit lane, and during a visit the lap it began on. */
  pitLanes: Array<PitLane | undefined>;
  /** Per car: the lap it is on, by the laps recorder's rule (`lap-boundary.ts`). */
  laps: Array<LapMark | undefined>;
  /** Per car: the newest lap that has a record (provisional or confirmed), 0 if none: where `SEND` closes the stint. */
  recordedLap: number[];
};

const openStint = (car: LiveCar, firstLap: number): OpenStint => ({
  firstLap,
  actualCompound: car.tyres.actualCompound,
  visualCompound: car.tyres.visualCompound,
  tyreAgeAtFitting: car.tyres.age,
  lastAge: car.tyres.age,
});

/** Records the stint, stamped `stamp`; one without a completed lap (the tyres changed before the first lap ended) is dropped. */
const closeStint = (log: LogWriter, carId: CarId, stint: OpenStint, lastLap: number, stamp: Stamp): boolean => {
  if (lastLap < stint.firstLap) return false;
  const { firstLap, actualCompound, visualCompound, tyreAgeAtFitting } = stint;
  log.append('stints', { carId, firstLap, lastLap, actualCompound, visualCompound, tyreAgeAtFitting, in: stamp });
  return true;
};

/** The car's lap after this frame, as the laps recorder sees it, and the laps it completed with a record. */
const trackLap = (own: StintsOwn, car: LiveCar, trackLengthM: number): void => {
  const mark = own.laps[car.id];
  const lapStep = lapStepOf(mark, car, trackLengthM);
  if (!mark || lapStep === 'first') own.laps[car.id] = lapMarkOf(car, true);
  else if (lapStep === 'restart') own.laps[car.id] = lapMarkOf(car, false);
  else if (lapStep === 'same') Object.assign(mark, { lapDistanceM: car.timing.lapDistanceM, lapTimeMs: car.timing.currentLapTimeMs });
  else {
    own.recordedLap[car.id] = Math.max(own.recordedLap[car.id] ?? 0, car.timing.lap - 1);
    own.laps[car.id] = lapMarkOf(car, false);
  }
};

/**
 * A new set is fitted when the compound changes or the age drops (a fresh set of the same compound). The old stint ends
 * with the in lap (the lap of the pit visit) and the new one starts with the first lap that starts on the new set. Once
 * the lap number is past the visit's lap (the pit lane passed the line), that is the next lap. Before that the change
 * waits while the car is in the pit lane or still on its in lap: in a race that lap ends at the line; in practice and
 * qualifying (the lap number does not advance through the garage) it restarts at the line after the out lap, on the
 * same lap number, so no lap driven on the new set lands in the old stint.
 */
const trackStint = (own: StintsOwn, car: LiveCar, log: LogWriter, stamp: Stamp): boolean => {
  const { actualCompound, age } = car.tyres;
  if (actualCompound === 'unknown') return false;
  const stint = own.stints[car.id];
  if (!stint) {
    own.stints[car.id] = openStint(car, car.timing.lap);
    return false;
  }
  if (actualCompound === stint.actualCompound && age >= stint.lastAge) {
    stint.lastAge = age;
    return false;
  }
  const visitLap = own.pitLanes[car.id]?.visitLap;
  const inLapDone = visitLap !== undefined ? car.timing.lap > visitLap : !own.laps[car.id]?.pitted;
  if (!inLapDone) return false;
  const lastLap = visitLap ?? car.timing.lap - 1;
  own.stints[car.id] = openStint(car, lastLap + 1);
  return closeStint(log, car.id, stint, lastLap, stamp);
};

/** The newest recorded lap of each car rebuilt from `laps`, the laps left in the history: the situation tracker's formation discard (until Task 9). */
export const reindexStintLaps = (own: StintsOwn, laps: ReadonlyArray<{ carId: CarId; lapNumber: number }>): void => {
  own.recordedLap = own.recordedLap.map(() => 0);
  for (const { carId, lapNumber } of laps) own.recordedLap[carId] = Math.max(own.recordedLap[carId] ?? 0, lapNumber);
};

/** No pit visit in progress: the situation tracker's formation discard (spec 3.2, until Task 9). */
export const endStintVisits = (own: StintsOwn): void => endVisits(own.pitLanes);

/** The car's lap starts over at lights out, as the laps recorder's does (the situation tracker, until Task 9). */
export const restartStintLap = (own: StintsOwn, car: LiveCar): void => {
  own.laps[car.id] = lapMarkOf(car, false);
};

/**
 * Stints come from Car Status; the session's end (`SEND`, step 2's `tracked.sessionEnded`) closes the stint every car
 * is still on, at its last recorded lap.
 */
export const stintsRecorder: Recorder<StintsOwn> = {
  id: 'stints',
  init: () => ({
    stints: Array.from({ length: MAX_CARS }, () => undefined),
    pitLanes: Array.from({ length: MAX_CARS }, () => undefined),
    laps: Array.from({ length: MAX_CARS }, () => undefined),
    recordedLap: Array.from({ length: MAX_CARS }, () => 0),
  }),
  apply(input, own, log, out) {
    const { at, live } = input;
    let closed = false;
    for (const car of carsWithLapData(input)) {
      const pit = pitLaneStep(own.pitLanes[car.id], car.timing.pitStatus, car.timing.lap);
      own.pitLanes[car.id] = pit.lane;
      markPitLane(own.laps[car.id], pit);
      trackLap(own, car, live.session.trackLengthM);
    }
    for (const car of live.cars) {
      // A final lap the game never rolled over has a record once Session History confirms it (the laps recorder's rule).
      const lap = own.laps[car.id]?.lap;
      if (car.updatedAt.sessionHistory === at && lap !== undefined && car.timing.confirmedLaps.some((l) => l.lapNumber === lap)) {
        own.recordedLap[car.id] = Math.max(own.recordedLap[car.id] ?? 0, lap);
      }
    }
    for (const car of carsWithLapData(input)) closed = trackStint(own, car, log, stampOf(input.stamps, car.id)) || closed;
    if (input.tracked?.sessionEnded) {
      for (const car of live.cars) {
        const stint = own.stints[car.id];
        if (!stint) continue;
        closed = closeStint(log, car.id, stint, own.recordedLap[car.id] ?? 0, stampOf(input.stamps, car.id)) || closed;
        own.stints[car.id] = undefined;
      }
    }
    if (closed) out.changed.add('stints');
    return own;
  },
};
