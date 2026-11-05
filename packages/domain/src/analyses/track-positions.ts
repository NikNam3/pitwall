// Value types of the `track-positions` analysis (spec 6.1).
import type { CarId } from '../ids.ts';
import type { spans as zoneFlagsSpans } from '../situations/zone-flags.ts';
import type { LapFraction, MapPoint } from '../track-file.ts';

/** `trackPositions.geometry` (a `Known` of it: `notApplicable` without a track file or without an outline). */
export type TrackGeometry = {
  outline: MapPoint[];
  turns: { label: string; point: MapPoint }[];
  /** The line, sector 2, sector 3. */
  sectorStarts: [MapPoint, MapPoint, MapPoint];
};

/**
 * One car on the map, at its lap distance. `inPit` while it is in the pit lane (drawn hollow); `blueFlag` while it is
 * shown blue. `raceNumber` with `teamId` is the car's key for its colour.
 */
export type MapCar = {
  carId: CarId;
  code: string;
  teamId: number;
  raceNumber: number;
  ours: boolean;
  point: MapPoint;
  inPit: boolean;
  blueFlag: boolean;
};

/** A marshal zone's flag on the lap: from its start to the next zone's (the last wraps to the first). */
export type MapZone = { start: LapFraction; end: LapFraction; flag: (typeof zoneFlagsSpans)['kinds'][number] };

/** `trackPositions.cars` (a `Known` of it: `notApplicable` without a track file or without an outline). */
export type TrackCars = { cars: MapCar[]; zones: MapZone[] };
