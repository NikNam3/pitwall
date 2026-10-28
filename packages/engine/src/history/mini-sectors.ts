import { MINI_SECTORS, type CarId, type Metres, type SessionTime } from '@pitwall/domain';
import type { EngineState } from '../state/engine-state.ts';
import type { SubStep } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';

type Cursor = NonNullable<EngineState['open']['miniSectors'][number]>;
/** A boundary the car passed between two samples, and how far along the path between them that was. */
type Crossing = { lap: number; segment: number; pathM: Metres };

const SEGMENTS = Array.from({ length: MINI_SECTORS }, (_, segment) => segment);

/** The boundaries passed between the cursor and the sample (spec: same lap, or the lap after). */
const crossingsBetween = (cursor: Cursor, lap: number, distanceM: Metres, trackLengthM: Metres): Crossing[] => {
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

const trackCar = (state: EngineState, carId: CarId, lap: number, distanceM: Metres, at: SessionTime): void => {
  const cursor = state.open.miniSectors[carId];
  const sample: Cursor = { lap, segment: -1, distanceM, at };
  state.open.miniSectors[carId] = sample;
  // The first sample, a lap jump and a lap going down emit nothing and start over.
  if (!cursor || (lap !== cursor.lap && lap !== cursor.lap + 1)) return;
  let last = { lap: cursor.lap, segment: cursor.segment };
  const { trackLengthM } = state.session;
  const path = lap === cursor.lap ? distanceM - cursor.distanceM : trackLengthM - cursor.distanceM + distanceM;
  for (const crossing of crossingsBetween(cursor, lap, distanceM, trackLengthM)) {
    if (!isAfter(crossing, last.lap, last.segment)) continue;
    last = crossing;
    const crossedAt = path === 0 ? cursor.at : Math.round(cursor.at + ((at - cursor.at) * crossing.pathM) / path);
    state.history.miniSectors.push({ carId, lap: crossing.lap, segment: crossing.segment, at: crossedAt });
  }
  sample.segment = last.lap === lap ? last.segment : -1;
};

/**
 * The time each active car passes each of the 50 equal-length segments of the lap, interpolated linearly in
 * distance between two frames. A crossing is recorded once, however the car jitters around the boundary.
 */
export const applyMiniSectors: SubStep = (state, frame, out) => {
  if (state.session.trackLengthM <= 0) return;
  const before = state.history.miniSectors.length;
  for (const car of carsWithLapData(state, frame)) {
    trackCar(state, car.id, car.timing.lap, car.timing.lapDistanceM, frame.sessionTime);
  }
  if (state.history.miniSectors.length > before) out.changed.add('miniSectors');
};
