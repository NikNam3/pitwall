import { MAX_CARS, type ActualCompound, type CarId, type FrameNumber, type VisualCompound } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import type { Recorder, RecorderInput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { carsInSession, type LiveCar } from './cars.ts';
import { initialRaceStartMark, postSessionOpened, raceStartStep, type RaceStartMark } from './race-start.ts';
import { activityOf, locationOf, RACE_ACTIVITY, recordsNoLap } from './spans.ts';

/** A set of tyres as Car Status shows it. */
type TyreSet = { actualCompound: ActualCompound; visualCompound: VisualCompound; age: number };

/** The stint a car is on, until it becomes a `StintRecord`. */
export type OpenStint = {
  firstLap: number;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  tyreAgeAtFitting: number;
  /** The set's age on the newest frame outside a fitting: a lower age in one is a fresh set. */
  lastAge: number;
};

/**
 * Where a car can be fitted a new set, by its spans: in the box (`boxStop`), in the garage (the timed activity's
 * `garage`), or in the pit lane on a penalty visit (`servingPenalty`), which is a fitting only once the car stopped in its
 * box (the pit stop timer, a value).
 */
type FittingKind = 'box' | 'garage' | 'penalty';

/** A fitting in progress: its kind, whether the car stopped in its box, and the new set, once seen. */
export type Fitting = { kind: FittingKind; stopped: boolean; fitted?: TyreSet };

/** The stint recorder's own open state (C10); per-car arrays are indexed by `CarId`. Its own copies of what it reads (C11). */
export type StintsOwn = {
  stints: Array<OpenStint | undefined>;
  /** Per car: the fitting it is in. */
  fittings: Array<Fitting | undefined>;
  /** Per car: while it is in the pit lane, the lap it entered it on (the in lap). */
  visitLaps: Array<number | undefined>;
  /** Per car: the lap it is on, counted while its laps are recorded (the laps recorder's rule, `spans.ts`). */
  laps: Array<number | undefined>;
  /** Per car: the newest lap that has a record (provisional or confirmed), 0 if none: where the session's end closes the stint. */
  recordedLap: number[];
  /** Where the race start is (its own copy, C11). */
  raceStart: RaceStartMark;
};

const setOf = (car: LiveCar): TyreSet => ({ actualCompound: car.tyres.actualCompound, visualCompound: car.tyres.visualCompound, age: car.tyres.age });

const openStint = (set: TyreSet, firstLap: number, lastAge: number): OpenStint => ({
  firstLap,
  actualCompound: set.actualCompound,
  visualCompound: set.visualCompound,
  tyreAgeAtFitting: set.age,
  lastAge,
});

/** Records the stint, describing frame `frame`; one without a completed lap (the tyres changed before the first lap ended) is dropped. */
const closeStint = (log: LogWriter, carId: CarId, stint: OpenStint, lastLap: number, frame: FrameNumber): boolean => {
  if (lastLap < stint.firstLap) return false;
  const { firstLap, actualCompound, visualCompound, tyreAgeAtFitting } = stint;
  log.append('stints', { carId, firstLap, lastLap, actualCompound, visualCompound, tyreAgeAtFitting, frame });
  return true;
};

/** The fitting the car is in on this frame, by its activity and location spans; none outside one. */
const fittingKindOf = (input: DeepReadonly<RecorderInput>, carId: CarId): FittingKind | undefined => {
  const activity = activityOf(input.situation, carId)?.kind;
  if (activity === 'boxStop') return 'box';
  if (activity === 'garage') return 'garage';
  return activity === 'servingPenalty' && locationOf(input.situation, carId)?.kind === 'pitLane' ? 'penalty' : undefined;
};

/** A different set from the stint's: another compound, or a lower age than the old set had (a fresh set of the same compound). */
const isNewSet = (stint: OpenStint, set: TyreSet): boolean => set.actualCompound !== stint.actualCompound || set.age < stint.lastAge;

/**
 * The fitting ended on this frame (`frame`): when it fitted a new set (and a penalty visit stopped in the box), the old
 * stint ends and the new one begins. In a race the old stint ends with the in lap, the lap the car entered the pit lane
 * on, and the new one begins with the next lap. In practice and qualifying the lap number does not advance through the
 * garage and the lap restarts at the line after the out lap, on the same lap number: the old stint ends with the lap
 * before, and the timed lap is on the new set.
 */
const endFitting = (own: StintsOwn, car: LiveCar, fitting: Fitting, log: LogWriter, frame: FrameNumber): boolean => {
  const stint = own.stints[car.id];
  const { fitted } = fitting;
  if (!stint || !fitted || (fitting.kind === 'penalty' && !fitting.stopped)) return false;
  const lastLap = fitting.kind === 'garage' ? car.timing.lap - 1 : (own.visitLaps[car.id] ?? car.timing.lap);
  own.stints[car.id] = openStint(fitted, lastLap + 1, car.tyres.age);
  return closeStint(log, car.id, stint, lastLap, frame);
};

/** Takes the frame's set into the fitting: the stopping in the box, and the first new set seen in it. */
const observeFitting = (fitting: Fitting, stint: OpenStint | undefined, car: LiveCar): void => {
  if (car.timing.pitStopTimerMs > 0) fitting.stopped = true;
  if (!stint || car.tyres.actualCompound === 'unknown') return;
  const set = setOf(car);
  if (isNewSet(stint, set) && fitting.fitted?.actualCompound !== set.actualCompound) fitting.fitted = set;
};

/**
 * The car's stint on this frame: its first stint opens with the first set seen; a fitting that ends closes the stint if
 * it fitted a new set (ruling 3); outside a fitting the set's age is followed and a change of set closes nothing.
 */
const trackStint = (own: StintsOwn, car: LiveCar, input: DeepReadonly<RecorderInput>, log: LogWriter): boolean => {
  const kind = fittingKindOf(input, car.id);
  const before = own.fittings[car.id];
  let closed = false;
  if (before && before.kind !== kind) {
    closed = endFitting(own, car, before, log, input.frameNumber);
    own.fittings[car.id] = undefined;
  }
  if (own.stints[car.id] === undefined && car.tyres.actualCompound !== 'unknown') own.stints[car.id] = openStint(setOf(car), car.timing.lap, car.tyres.age);
  const stint = own.stints[car.id];
  if (kind) {
    const fitting = own.fittings[car.id] ?? { kind, stopped: false };
    observeFitting(fitting, stint, car);
    own.fittings[car.id] = fitting;
  } else if (stint && car.tyres.actualCompound === stint.actualCompound) {
    stint.lastAge = car.tyres.age;
  }
  const inPitLane = locationOf(input.situation, car.id)?.kind === 'pitLane';
  own.visitLaps[car.id] = inPitLane ? (own.visitLaps[car.id] ?? car.timing.lap) : undefined;
  return closed;
};

/** The car's lap after this frame and the laps it completed with a record, by the laps recorder's rule. */
const trackLap = (own: StintsOwn, car: LiveCar, input: DeepReadonly<RecorderInput>): void => {
  if (car.updatedAt.lapData !== input.at || recordsNoLap(input.situation, car.id, input.frameNumber)) return;
  const lap = own.laps[car.id];
  if (lap !== undefined && car.timing.lap > lap) own.recordedLap[car.id] = Math.max(own.recordedLap[car.id] ?? 0, car.timing.lap - 1);
  own.laps[car.id] = car.timing.lap;
  // A race finisher's final lap has its record once its activity turns `finished` (the laps recorder's `finishLap`).
  const activity = activityOf(input.situation, car.id);
  if (activity?.machine === RACE_ACTIVITY && activity.kind === 'finished' && activity.startFrame === input.frameNumber) {
    own.recordedLap[car.id] = Math.max(own.recordedLap[car.id] ?? 0, car.timing.lap);
  }
};

/**
 * The race start (`raceStartStep`): every car in the session that has had LapData starts its lap over, as the laps
 * recorder's does, and no lap of the formation lap counts as recorded (its records are hidden, C29). The stints stay as
 * they are.
 */
const restartLaps = (own: StintsOwn, input: DeepReadonly<RecorderInput>): void => {
  for (const car of carsInSession(input)) if (car.updatedAt.lapData !== undefined) own.laps[car.id] = car.timing.lap;
  own.recordedLap.fill(0);
};

/**
 * Stints come from Car Status and the car's spans (C10): a stint closes when a box stop, a garage span or a penalty visit
 * that stopped in the box ends on a new set, describing the frame it ended on (a penalty visit's: its pit exit, C26); the
 * session's end (the frame a `postSession` span opens, C10: SEND or the clock's simulated end) closes the stint every car
 * is still on, at its last recorded lap. No signal is read (C13).
 */
export const stintsRecorder: Recorder<StintsOwn> = {
  id: 'stints',
  init: () => ({
    stints: Array.from({ length: MAX_CARS }, () => undefined),
    fittings: Array.from({ length: MAX_CARS }, () => undefined),
    visitLaps: Array.from({ length: MAX_CARS }, () => undefined),
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
    const cars = carsInSession(input);
    for (const car of cars) trackLap(own, car, input);
    for (const car of live.cars) {
      // A final lap the game never rolled over has a record once Session History confirms it (the laps recorder's rule).
      const lap = own.laps[car.id];
      if (car.updatedAt.sessionHistory === at && lap !== undefined && car.timing.confirmedLaps.some((l) => l.lapNumber === lap)) {
        own.recordedLap[car.id] = Math.max(own.recordedLap[car.id] ?? 0, lap);
      }
    }
    for (const car of cars) closed = trackStint(own, car, input, log) || closed;
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
