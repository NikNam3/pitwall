// Value types of the `gaps` analysis (spec 6.1, A.3). Every gap comes from the mini-sector crossings, never from the game's gaps.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/**
 * `gaps.intervals`: one car's gaps to the leader and its neighbours on the road order, its laps down, and the positions
 * it gained since the start (`gridPosition − position`; negative = lost): `notApplicable` outside a race, `notReceived`
 * until the grid position is known.
 */
export type Interval = {
  carId: CarId;
  toLeaderMs: Known<Ms>;
  toAheadMs: Known<Ms>;
  toBehindMs: Known<Ms>;
  lapsDown: number;
  positionsGained: Known<number>;
};

/**
 * `gaps.toCar`: one car's signed gap to the params car; positive = behind it. `lapsDown` is signed and relative to the
 * params car: the laps this car is down on it (negative = laps ahead), on top of `gapMs`.
 */
export type GapToCar = { carId: CarId; gapMs: Known<Ms>; lapsDown: number };

/** The virtual car of the gapper: the leader's mean lap so far (default), a car's mean lap, or a fixed lap time. */
export type GapperReference = { kind: 'leaderAverage' } | { kind: 'carAverage'; carId: CarId } | { kind: 'fixed'; lapMs: Ms };

/** `gaps.gapper`: per car, per completed lap, the gap to the virtual car at constant pace. */
export type GapperLines = { referenceLapMs: Known<Ms>; cars: { carId: CarId; byLap: { lap: number; gapMs: Ms }[] }[] };

/** `gaps.neighbourhood`: the cars within ±1 position or ±`neighbourhoodMs` of one of our cars. */
export type Neighbourhood = { ourCarId: CarId; carIds: CarId[] };
