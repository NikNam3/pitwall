import { MAX_CARS, type CarId, type FrameNumber, type Ms, type PitStopRecord, type SessionTime } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import type { Recorder, RecorderInput } from '../step/types.ts';
import { carSpanIn } from '../util/car-span.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { carsInSession, type LiveCar } from './cars.ts';
import { locationOf, neutralisedBy, RACE_ACTIVITY } from './spans.ts';

/** A car's visit to the pit lane while it is in it: what the record of a stop needs. */
export type OpenPitVisit = {
  /** The lap the car entered the pit lane on. */
  lap: number;
  entry: SessionTime;
  pitLaneTimeMs: Ms;
  stationaryTimeMs: Ms;
  /** A `boxStop` span of the car's race activity was open during the visit. */
  boxStop: boolean;
  /** The id of the visit's `servingPenalty` span, when it is a penalty visit. */
  penaltySpan?: number;
};

/** A penalty visit that stopped in the box, past its pit exit, until its `servingPenalty` span closes. */
export type ExitedPenaltyVisit = { visit: OpenPitVisit; penaltySpan: number; exit: { at: SessionTime; frame: FrameNumber; flag: PitStopRecord['flag'] } };

/** The pit-stop recorder's own open state (C10); per-car arrays are indexed by `CarId`. */
export type PitStopsOwn = {
  visits: Array<OpenPitVisit | undefined>;
  exited: Array<ExitedPenaltyVisit | undefined>;
};

/** The flag of a pit stop: the car neutralising the session at its pit exit (the race's `neutralised` span), else green. */
const flagAt = (input: DeepReadonly<RecorderInput>): PitStopRecord['flag'] => {
  const car = neutralisedBy(input.situation);
  return car === 'SC' ? 'sc' : car === 'VSC' ? 'vsc' : 'green';
};

const record = (log: LogWriter, carId: CarId, visit: OpenPitVisit, exit: ExitedPenaltyVisit['exit'], penaltyServed: boolean): void => {
  log.append('pitStops', {
    carId,
    lap: visit.lap,
    pitLaneEntry: visit.entry,
    pitLaneExit: exit.at,
    // The game's pit lane timer, or the observed duration when it never ran.
    pitLaneTimeMs: visit.pitLaneTimeMs > 0 ? visit.pitLaneTimeMs : exit.at - visit.entry,
    stationaryTimeMs: visit.stationaryTimeMs,
    flag: exit.flag,
    penaltyServed,
    frame: exit.frame,
  });
};

/** The car's race activity span on this frame; none before the lights out or outside a race. */
const raceActivityOf = (input: DeepReadonly<RecorderInput>, carId: CarId) => carSpanIn(input.situation.byMachine[RACE_ACTIVITY], carId);

/** The car's visit on a frame in the pit lane: opened at its entry, with the times and the spans of its frames. */
const inPitLane = (own: PitStopsOwn, car: LiveCar, entry: SessionTime, input: DeepReadonly<RecorderInput>): void => {
  const visit = own.visits[car.id] ?? { lap: car.timing.lap, entry, pitLaneTimeMs: 0, stationaryTimeMs: 0, boxStop: false };
  visit.pitLaneTimeMs = Math.max(visit.pitLaneTimeMs, car.timing.pitLaneTimeMs);
  visit.stationaryTimeMs = Math.max(visit.stationaryTimeMs, car.timing.pitStopTimerMs);
  const activity = raceActivityOf(input, car.id);
  if (activity?.kind === 'boxStop') visit.boxStop = true;
  if (activity?.kind === 'servingPenalty') visit.penaltySpan = activity.id;
  own.visits[car.id] = visit;
};

/**
 * The car left the pit lane on this frame. A visit that stopped in the box is a pit stop: a box stop's is recorded now; a
 * penalty visit's waits for its `servingPenalty` span to close (up to 10 s after the exit), as only that tells whether
 * the penalty was served. A pass through the pit lane, a penalty visit with no stop and a visit that ends in the garage
 * are none.
 */
const leftPitLane = (own: PitStopsOwn, car: LiveCar, onTrack: boolean, input: DeepReadonly<RecorderInput>, log: LogWriter): boolean => {
  const visit = own.visits[car.id];
  own.visits[car.id] = undefined;
  if (!visit || !onTrack) return false;
  const exit = { at: input.at, frame: input.frameNumber, flag: flagAt(input) };
  if (visit.penaltySpan !== undefined) {
    if (visit.stationaryTimeMs > 0) own.exited[car.id] = { visit, penaltySpan: visit.penaltySpan, exit };
    return false;
  }
  if (!visit.boxStop) return false;
  record(log, car.id, visit, exit, false);
  return true;
};

/**
 * A penalty visit past its exit whose `servingPenalty` span closed on this frame: one pit stop, describing the pit exit
 * (C26), served when the span closed confirmed (C18).
 */
const penaltySpanClosed = (own: PitStopsOwn, carId: CarId, input: DeepReadonly<RecorderInput>, log: LogWriter): boolean => {
  const pending = own.exited[carId];
  if (!pending || raceActivityOf(input, carId)?.id === pending.penaltySpan) return false;
  own.exited[carId] = undefined;
  const closed = input.closed?.[RACE_ACTIVITY]?.find((s) => s.carId === carId && s.id === pending.penaltySpan);
  record(log, carId, pending.visit, pending.exit, closed?.confirmed === true);
  return true;
};

/**
 * A pit stop is a race visit to the pit lane that stopped in the box (C10): one record per `boxStop` span of the car's
 * race activity, and per `servingPenalty` span during which the car stopped in its box (the pit stop timer, a value),
 * which is `penaltyServed` when the span closed confirmed. The visit runs from the car-location `pitLane` span's start to
 * the next `track` span; the record describes that pit exit (C26) and takes its flag from the spans open then, the
 * race's `neutralised` span (membership, C26). A box stop's record is appended at the exit, a penalty visit's on the
 * frame its span closes. Practice and qualifying, and the formation lap (no activity before the lights out), record none.
 * No signal is read (C13).
 */
export const pitStopsRecorder: Recorder<PitStopsOwn> = {
  id: 'pitStops',
  init: () => ({
    visits: Array.from({ length: MAX_CARS }, () => undefined),
    exited: Array.from({ length: MAX_CARS }, () => undefined),
  }),
  apply(input, own, log, out) {
    let recorded = false;
    for (const car of carsInSession(input)) {
      const location = locationOf(input.situation, car.id);
      if (location?.kind === 'pitLane') inPitLane(own, car, location.start, input);
      else if (own.visits[car.id]) recorded = leftPitLane(own, car, location?.kind === 'track', input, log) || recorded;
      recorded = penaltySpanClosed(own, car.id, input, log) || recorded;
    }
    if (recorded) out.changed.add('pitStops');
    return own;
  },
};
