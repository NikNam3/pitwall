import { MAX_CARS, MINI_SECTORS, type CarId, type Metres, type SessionTime, type Stamp } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import { stampOf, type Recorder } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';

/** Where a car was on its previous LapData frame, and the last segment it crossed in that lap (-1 = none). */
export type MiniSectorCursor = { lap: number; segment: number; distanceM: Metres; at: SessionTime };

/** The mini-sector recorder's own open state (C10): per car, indexed by `CarId`. */
export type MiniSectorsOwn = { cursors: Array<MiniSectorCursor | undefined> };

/** A boundary the car passed between two samples, and how far along the path between them that was. */
type Crossing = { lap: number; segment: number; pathM: Metres };

const SEGMENTS = Array.from({ length: MINI_SECTORS }, (_, segment) => segment);

/** The boundaries passed between the cursor and the sample (spec: same lap, or the lap after). */
const crossingsBetween = (cursor: MiniSectorCursor, lap: number, distanceM: Metres, trackLengthM: Metres): Crossing[] => {
  const boundary = (segment: number): Metres => (segment * trackLengthM) / MINI_SECTORS;
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

/** Records the car's crossings since its previous sample; whether it appended one. */
const trackCar = (own: MiniSectorsOwn, sample: { carId: CarId; lap: number; distanceM: Metres; at: SessionTime; in: Stamp }, trackLengthM: Metres, log: LogWriter): boolean => {
  const { carId, lap, distanceM, at } = sample;
  const cursor = own.cursors[carId];
  const next: MiniSectorCursor = { lap, segment: -1, distanceM, at };
  own.cursors[carId] = next;
  // The first sample, a lap jump and a lap going down emit nothing and start over.
  if (!cursor || (lap !== cursor.lap && lap !== cursor.lap + 1)) return false;
  let last = { lap: cursor.lap, segment: cursor.segment };
  const path = lap === cursor.lap ? distanceM - cursor.distanceM : trackLengthM - cursor.distanceM + distanceM;
  let appended = false;
  for (const crossing of crossingsBetween(cursor, lap, distanceM, trackLengthM)) {
    if (!isAfter(crossing, last.lap, last.segment)) continue;
    last = crossing;
    const crossedAt = path === 0 ? cursor.at : Math.round(cursor.at + ((at - cursor.at) * crossing.pathM) / path);
    log.append('crossings', { carId, lap: crossing.lap, segment: crossing.segment, at: crossedAt, in: sample.in });
    appended = true;
  }
  next.segment = last.lap === lap ? last.segment : -1;
  return appended;
};

/** No car's crossings carry on: the situation tracker's formation discard starts them over (spec 3.2, until Task 9). */
export const restartMiniSectors = (own: MiniSectorsOwn): void => {
  own.cursors.fill(undefined);
};

/**
 * The time each active car passes each of the 50 equal-length segments of the lap, interpolated linearly in
 * distance between two frames. A crossing is recorded once, however the car jitters around the boundary.
 */
export const miniSectorsRecorder: Recorder<MiniSectorsOwn> = {
  id: 'miniSectors',
  init: () => ({ cursors: Array.from({ length: MAX_CARS }, () => undefined) }),
  apply(input, own, log, out) {
    const { trackLengthM } = input.live.session;
    if (trackLengthM <= 0) return own;
    let appended = false;
    for (const car of carsWithLapData(input)) {
      const sample = { carId: car.id, lap: car.timing.lap, distanceM: car.timing.lapDistanceM, at: input.at, in: stampOf(input.stamps, car.id) };
      appended = trackCar(own, sample, trackLengthM, log) || appended;
    }
    if (appended) out.changed.add('miniSectors');
    return own;
  },
};
