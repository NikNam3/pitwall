// Value types of the `circle` analysis (SP4.3d spec §6.5): the field as a lap circle, and the ghosts of a stop.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';
import type { PitCondition } from './pit-losses.ts';

/** A car's place on the circle: how far behind our car it is, 0 … one lap. */
export type CircleCar = { carId: CarId; behindMs: Ms };

/** Our car as if it had stopped now, under one condition. */
export type CircleGhost = {
  condition: PitCondition;
  behindMs: Known<Ms>;
  rejoinPosition: Known<number>;
  aheadMs: Known<Ms>;
  behindCarMs: Known<Ms>;
};

/** `circle.car`: one of our cars' lap circle. */
export type Circle = { carId: CarId; lapMs: Known<Ms>; cars: Known<CircleCar[]>; ghosts: CircleGhost[]; current: PitCondition };
