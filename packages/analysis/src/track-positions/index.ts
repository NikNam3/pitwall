// `track-positions` (spec 6.1): publishes `trackPositions.geometry` and `trackPositions.cars`. No config.
import type { Known, TrackCars, TrackGeometry } from '@pitwall/domain';

export type { MapCar, MapZone, TrackCars, TrackGeometry } from '@pitwall/domain';
export * from './behaviour.ts';

/** The calculator id. */
export const TRACK_POSITIONS = 'track-positions';

/** The output: the bindings' `select` picks `geometry` and `cars`. */
export type TrackPositionsOutput = { geometry: Known<TrackGeometry>; cars: Known<TrackCars> };
