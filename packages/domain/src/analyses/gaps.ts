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
 * params car: the laps this car is down on it (negative = laps ahead), on top of `gapMs`. The params car's own entry
 * is `notApplicable` with `lapsDown` 0; so is a car out of the race (its gap will not come).
 */
export type GapToCar = { carId: CarId; gapMs: Known<Ms>; lapsDown: number };

/** The virtual car of the gapper: the leader's mean lap so far (default), a car's mean lap, or a fixed lap time. */
export type GapperReference = { kind: 'leaderAverage' } | { kind: 'carAverage'; carId: CarId } | { kind: 'fixed'; lapMs: Ms };

/** The kinds of gapper reference. */
export type GapperReferenceKind = GapperReference['kind'];

/**
 * `gaps.gapper`: per car, per completed lap, the gap to the virtual car at constant pace. `reference` is what the
 * gapper resolved: its kind and, for `carAverage`, the car (`carId` is `notApplicable` for `leaderAverage` and `fixed`).
 * A car out of the race keeps its completed race laps; its `now` is `notApplicable`.
 */
export type GapperLines = {
  reference: { kind: GapperReferenceKind; carId: Known<CarId> };
  referenceLapMs: Known<Ms>;
  /** Only the cars in the window: our cars and every car within ±`windowMs` of one of them (leaving beyond ±(`windowMs` + `windowExitMs`)). */
  cars: {
    carId: CarId;
    /**
     * The car's gaps per mini-sector crossing for the last `fineLaps` laps, per lap before; `lap` counts completed laps
     * plus the crossed mini-sectors / 50.
     */
    points: { lap: number; gapMs: Ms }[];
    /**
     * The car's gap now, at its newest mini-sector crossing: `lap` counts completed laps plus the part of the current
     * lap (crossed mini-sectors / 50), so it lies after the last `points` point. `notApplicable` before the first crossing
     * after lights out, or when it would equal the last completed lap.
     */
    now: Known<{ lap: number; gapMs: Ms }>;
  }[];
  /**
   * The race's neutralised phases in the leader's progress (completed laps plus the part of the current lap, from the
   * leader's crossings at the phase start and end), on the same x as `points` and `now`; `toLap` `notApplicable` while
   * the phase is open.
   */
  phases: { kind: 'SC' | 'VSC' | 'red'; fromLap: number; toLap: Known<number> }[];
};

/** `gaps.neighbourhood`: the cars within ±1 position or ±`neighbourhoodMs` of one of our cars. */
export type Neighbourhood = { ourCarId: CarId; carIds: CarId[] };
