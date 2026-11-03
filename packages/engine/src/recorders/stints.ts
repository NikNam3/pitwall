import { MAX_CARS, type ActualCompound, type CarId, type FrameNumber, type VisualCompound } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import type { Recorder, RecorderInput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { carsInSession, carsWithLapData, type LiveCar } from './cars.ts';
import { lapMarkOf, lapStepOf, markPitLane, type LapMark } from './lap-boundary.ts';
import { endVisits, pitLaneStep, type PitLane } from './pit-lane.ts';
import { initialRaceStartMark, postSessionOpened, raceStartStep, type RaceStartMark } from './race-start.ts';

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
  /** Per car: the newest lap that has a record (provisional or confirmed), 0 if none: where the session's end closes the stint. */
  recordedLap: number[];
  /** Where the race start is (its own copy, C11). */
  raceStart: RaceStartMark;
};

const openStint = (car: LiveCar, firstLap: number): OpenStint => ({
  firstLap,
  actualCompound: car.tyres.actualCompound,
  visualCompound: car.tyres.visualCompound,
  tyreAgeAtFitting: car.tyres.age,
  lastAge: car.tyres.age,
});

/** Records the stint, describing frame `frame`; one without a completed lap (the tyres changed before the first lap ended) is dropped. */
const closeStint = (log: LogWriter, carId: CarId, stint: OpenStint, lastLap: number, frame: FrameNumber): boolean => {
  if (lastLap < stint.firstLap) return false;
  const { firstLap, actualCompound, visualCompound, tyreAgeAtFitting } = stint;
  log.append('stints', { carId, firstLap, lastLap, actualCompound, visualCompound, tyreAgeAtFitting, frame });
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
const trackStint = (own: StintsOwn, car: LiveCar, log: LogWriter, frame: FrameNumber): boolean => {
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
  return closeStint(log, car.id, stint, lastLap, frame);
};

/**
 * The race start (`raceStartStep`): every car in the session that has had LapData starts its lap over, as the laps
 * recorder's does; no pit visit goes on (a pit-lane start), and no lap of the formation lap counts as recorded (its
 * records are hidden, C29). The stints stay as they are.
 */
const restartLaps = (own: StintsOwn, input: DeepReadonly<RecorderInput>): void => {
  for (const car of carsInSession(input)) if (car.updatedAt.lapData !== undefined) own.laps[car.id] = lapMarkOf(car, false);
  endVisits(own.pitLanes);
  own.recordedLap.fill(0);
};

/**
 * Stints come from Car Status; the session's end (the frame a `postSession` span opens, C10: SEND or the clock's
 * simulated end) closes the stint every car is still on, at its last recorded lap.
 */
export const stintsRecorder: Recorder<StintsOwn> = {
  id: 'stints',
  init: () => ({
    stints: Array.from({ length: MAX_CARS }, () => undefined),
    pitLanes: Array.from({ length: MAX_CARS }, () => undefined),
    laps: Array.from({ length: MAX_CARS }, () => undefined),
    recordedLap: Array.from({ length: MAX_CARS }, () => 0),
    raceStart: initialRaceStartMark(),
  }),
  apply(input, own, log, out) {
    const { at, live } = input;
    let closed = false;
    const start = raceStartStep(own.raceStart, input.situation);
    own.raceStart = start.mark;
    if (start.started) restartLaps(own, input);
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
    for (const car of carsWithLapData(input)) closed = trackStint(own, car, log, input.frameNumber) || closed;
    if (postSessionOpened(input.situation, input.frameNumber)) {
      for (const car of live.cars) {
        const stint = own.stints[car.id];
        if (!stint) continue;
        closed = closeStint(log, car.id, stint, own.recordedLap[car.id] ?? 0, input.frameNumber) || closed;
        own.stints[car.id] = undefined;
      }
    }
    if (closed) out.changed.add('stints');
    return own;
  },
};
