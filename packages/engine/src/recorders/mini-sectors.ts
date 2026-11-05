import { MAX_CARS, MINI_SECTORS, type CarId, type FactRef, type FrameNumber, type Metres, type MiniSectorCrossing, type SessionTime } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import type { Recorder } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';
import { lapStepOf } from './lap-boundary.ts';
import { initialRaceStartMark, raceStartStep, type RaceStartMark } from './race-start.ts';
import { activityOf, finishOpened, recordsNoLap } from './spans.ts';

/** Where a car was on its previous LapData frame, and the last segment it crossed in that lap (-1 = none). */
export type MiniSectorCursor = { lap: number; segment: number; distanceM: Metres; at: SessionTime };

/** The lap of a car's newest crossing and, per segment, the id of the lap's newest crossing of it (C21). */
export type LapCrossings = { lap: number; refs: Array<FactRef | undefined> };

/**
 * The mini-sector recorder's own open state (C10): per car, indexed by `CarId`, its cursor, the line crossing of its
 * newest crossing of the line on the same lap number (the lap distance fell, the lap number stayed), kept in case it
 * ends the car's final lap, and the crossings of its current lap, which a restarted lap supersedes (C25); where the
 * race start is (its own copy, C11).
 */
export type MiniSectorsOwn = {
  cursors: Array<MiniSectorCursor | undefined>;
  finalLines: Array<MiniSectorCrossing | undefined>;
  lapCrossings: Array<LapCrossings | undefined>;
  raceStart: RaceStartMark;
};

/** A boundary the car passed between two samples, and how far along the path between them that was. */
type Crossing = { lap: number; segment: number; pathM: Metres };

const SEGMENTS = Array.from({ length: MINI_SECTORS }, (_, segment) => segment);

/** Where the boundary of `segment` lies on a track `trackLengthM` long. */
const boundaryOf = (segment: number, trackLengthM: Metres): Metres => (segment * trackLengthM) / MINI_SECTORS;

/** The boundaries passed between the cursor and the sample (spec: same lap, or the lap after). */
const crossingsBetween = (cursor: MiniSectorCursor, lap: number, distanceM: Metres, trackLengthM: Metres): Crossing[] => {
  const boundary = (segment: number): Metres => boundaryOf(segment, trackLengthM);
  const from = cursor.distanceM;
  if (lap === cursor.lap) {
    return SEGMENTS.filter((s) => from < boundary(s) && boundary(s) <= distanceM).map((s) => ({
      lap,
      segment: s,
      pathM: boundary(s) - from,
    }));
  }
  const toLine = trackLengthM - from;
  return [
    ...SEGMENTS.filter((s) => boundary(s) > from).map((s) => ({ lap: cursor.lap, segment: s, pathM: boundary(s) - from })),
    ...SEGMENTS.filter((s) => boundary(s) <= distanceM).map((s) => ({ lap, segment: s, pathM: toLine + boundary(s) })),
  ];
};

const isAfter = (crossing: Crossing, lap: number, segment: number): boolean =>
  crossing.lap > lap || (crossing.lap === lap && crossing.segment > segment);

type Sample = { carId: CarId; lap: number; distanceM: Metres; at: SessionTime; frame: FrameNumber };

/**
 * The time on the path from the cursor to the sample, `pathM` along it of `path`, interpolated linearly and kept between
 * the two samples (a lap distance past the track length puts the line behind the cursor).
 */
const timeAlong = (cursor: MiniSectorCursor, at: SessionTime, pathM: Metres, path: Metres): SessionTime =>
  path <= 0 ? cursor.at : Math.round(cursor.at + ((at - cursor.at) * Math.min(Math.max(pathM, 0), path)) / path);

/**
 * The line crossing of a crossing of the line on the same lap number: segment 0 of the next lap, interpolated over the
 * wrapped distance like any lap wrap, describing the sample's frame (C26).
 */
const lineCrossingOf = (cursor: MiniSectorCursor, sample: Sample, trackLengthM: Metres): MiniSectorCrossing => {
  const toLine = trackLengthM - cursor.distanceM;
  const at = timeAlong(cursor, sample.at, toLine, toLine + sample.distanceM);
  return { carId: sample.carId, lap: sample.lap + 1, segment: 0, at, frame: sample.frame };
};

/**
 * Appends the crossing; a crossing of a (car, lap, segment) the car's current lap already recorded names the newest
 * earlier one it supersedes (C25). A crossing of another lap begins the car's current lap.
 */
const appendCrossing = (own: MiniSectorsOwn, crossing: MiniSectorCrossing, log: LogWriter): void => {
  const kept = own.lapCrossings[crossing.carId];
  const current = kept?.lap === crossing.lap ? kept : { lap: crossing.lap, refs: [] };
  const earlier = current.refs[crossing.segment];
  current.refs[crossing.segment] = log.append('crossings', earlier ? { ...crossing, supersedes: earlier } : crossing);
  own.lapCrossings[crossing.carId] = current;
};

/**
 * The lap restarts at the line on the same lap number (`lapStepOf`: `restart`): the line (segment 0 of the lap) and every
 * boundary after it up to the sample are crossed, interpolated over the path from the cursor through the line (from a
 * lap distance below 0, or over the wrap); the pass before it is not carried on. Whether it appended one.
 */
const restartLap = (own: MiniSectorsOwn, cursor: MiniSectorCursor, sample: Sample, next: MiniSectorCursor, trackLengthM: Metres, log: LogWriter): boolean => {
  const { carId, lap, distanceM, at, frame } = sample;
  const toLine = cursor.distanceM < 0 ? -cursor.distanceM : trackLengthM - cursor.distanceM;
  const path = toLine + distanceM;
  const passed = SEGMENTS.filter((s) => boundaryOf(s, trackLengthM) <= distanceM);
  for (const segment of passed) {
    const crossedAt = timeAlong(cursor, at, toLine + boundaryOf(segment, trackLengthM), path);
    appendCrossing(own, { carId, lap, segment, at: crossedAt, frame }, log);
  }
  next.segment = passed.at(-1) ?? -1;
  return passed.length > 0;
};

/** The path from the cursor to the sample on the same lap number passes the line: from below 0, or over a wrap. */
const passesLine = (cursor: MiniSectorCursor, distanceM: Metres): boolean => cursor.distanceM < 0 || distanceM < cursor.distanceM;

/** Records the car's crossings since its previous sample, from the line where the lap restarts (`restart`); whether it appended one. */
const trackCar = (own: MiniSectorsOwn, sample: Sample, restart: boolean, trackLengthM: Metres, log: LogWriter): boolean => {
  const { carId, lap, distanceM, at } = sample;
  const cursor = own.cursors[carId];
  const next: MiniSectorCursor = { lap, segment: -1, distanceM, at };
  own.cursors[carId] = next;
  // The first sample, a lap jump and a lap going down emit nothing and start over.
  if (!cursor || (lap !== cursor.lap && lap !== cursor.lap + 1)) return false;
  if (restart && lap === cursor.lap && passesLine(cursor, distanceM)) return restartLap(own, cursor, sample, next, trackLengthM, log);
  // A crossing of the line on the same lap number is kept in case it ends the car's final lap (`finishLine`).
  if (lap === cursor.lap && distanceM < cursor.distanceM) own.finalLines[carId] = lineCrossingOf(cursor, sample, trackLengthM);
  let last = { lap: cursor.lap, segment: cursor.segment };
  const path = lap === cursor.lap ? distanceM - cursor.distanceM : trackLengthM - cursor.distanceM + distanceM;
  let appended = false;
  for (const crossing of crossingsBetween(cursor, lap, distanceM, trackLengthM)) {
    if (!isAfter(crossing, last.lap, last.segment)) continue;
    last = crossing;
    const crossedAt = timeAlong(cursor, at, crossing.pathM, path);
    appendCrossing(own, { carId, lap: crossing.lap, segment: crossing.segment, at: crossedAt, frame: sample.frame }, log);
    appended = true;
  }
  next.segment = last.lap === lap ? last.segment : -1;
  return appended;
};

/**
 * A finisher's final lap ends at the line (C26, as its lap record does): when the car's race activity opens `finished`
 * on this frame, the line crossing kept from this frame or the one before is appended, describing the frame the lap
 * distance wrapped on (the game does not raise the lap number at the chequered flag). Whether it appended one.
 */
const finishLine = (own: MiniSectorsOwn, carId: CarId, opened: boolean, frameNumber: FrameNumber, log: LogWriter): boolean => {
  if (!opened) return false;
  const line = own.finalLines[carId];
  own.finalLines[carId] = undefined;
  if (!line || line.frame < frameNumber - 1) return false;
  appendCrossing(own, line, log);
  return true;
};

/**
 * The time each active car passes each of the 50 equal-length segments of the lap, interpolated linearly in
 * distance between two frames. A crossing is recorded once, however the car jitters around the boundary. At the race
 * start (`raceStartStep`) no car's crossings carry on: the formation lap crossed lap 1's boundaries already, and lap 1
 * is crossed again from lights out (spec 3.2; what the formation lap recorded stays, hidden, C29). No crossing is
 * recorded on a frame where the laps recorder records no lap (`recordsNoLap`: the car cools down, competes no more, or
 * the session is over); the car's crossings start over after it. In practice and qualifying a lap restarts at the line
 * on the same lap number after an out lap (`lapStepOf`: `restart`, the laps recorder's rule): its crossings are recorded
 * again from the line, each superseding the lap's earlier crossing of its segment (C25). A race never restarts, and its
 * lap 1 from lights out supersedes nothing the formation lap recorded.
 */
export const miniSectorsRecorder: Recorder<MiniSectorsOwn> = {
  id: 'miniSectors',
  init: () => ({
    cursors: Array.from({ length: MAX_CARS }, () => undefined),
    finalLines: Array.from({ length: MAX_CARS }, () => undefined),
    lapCrossings: Array.from({ length: MAX_CARS }, () => undefined),
    raceStart: initialRaceStartMark(),
  }),
  apply(input, own, log, out) {
    const { situation, frameNumber } = input;
    const start = raceStartStep(own.raceStart, situation);
    own.raceStart = start.mark;
    if (start.started) {
      own.cursors.fill(undefined);
      own.finalLines.fill(undefined);
      own.lapCrossings.fill(undefined);
    }
    const { trackLengthM } = input.live.session;
    if (trackLengthM <= 0) return own;
    let appended = false;
    for (const car of carsWithLapData(input)) {
      if (recordsNoLap(situation, car.id, frameNumber)) {
        own.cursors[car.id] = undefined;
        own.finalLines[car.id] = undefined;
        continue;
      }
      const sample = { carId: car.id, lap: car.timing.lap, distanceM: car.timing.lapDistanceM, at: input.at, frame: frameNumber };
      const activity = activityOf(situation, car.id);
      const restart = lapStepOf(own.cursors[car.id], car, activity, frameNumber) === 'restart';
      appended = trackCar(own, sample, restart, trackLengthM, log) || appended;
      appended = finishLine(own, car.id, finishOpened(activity, frameNumber), frameNumber, log) || appended;
    }
    if (appended) out.changed.add('miniSectors');
    return own;
  },
};
