// Value types of the `rejoin` analysis (SP4.2 spec 3.2): our car as if it were in the pit lane now, per condition.
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { MapPoint } from '../track-file.ts';
import type { Ms } from '../units.ts';
import type { PitCondition } from './pit-losses.ts';

/**
 * One row of a crossing order: a car, or the ghost (our own car id with `ghost: true`), its race position, and the gap
 * to the row ahead (positive = behind); the first row's gap is to the car ahead of it in the full order.
 */
export type CrossingRow = { carId: CarId; position: number; intervalMs: Known<Ms>; ghost: boolean };

/** Our car as if it were in the pit lane now, under one condition. */
export type RejoinAt = {
  condition: PitCondition;
  lossMs: Known<Ms>;
  lossSource: EstimateSource;
  /** Our race position at pit exit: lapped cars do not count. */
  rejoinPosition: Known<number>;
  /** Physical order, `orderAround` cars either side of the ghost, the ghost row included; `insufficientData` before our first crossing. */
  order: Known<CrossingRow[]>;
  /** Where our car was `lossMs` ago; `notApplicable` without a track file. */
  mapPoint: Known<MapPoint>;
};

/** `rejoin.car`: one of our cars, its race position now and the ghost per condition. */
export type Rejoin = { carId: CarId; position: number; conditions: Record<PitCondition, RejoinAt> };

/** `rejoin.ghostLines`: per our car and condition, our gapper line over the last `ghostLaps` laps plus the loss. */
export type GhostLines = { lines: { carId: CarId; condition: PitCondition; points: { lap: number; gapMs: Ms }[] }[] };
