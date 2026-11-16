// `circle`'s unit id and output type, in their own module so the calculator and the index both import them without a
// cycle (the index re-exports the calculator).
import type { CarId, Circle } from '@pitwall/domain';

/** The analysis id. */
export const CIRCLE = 'circle';

/** The output: per our car its `circle.car` value (a rival, or a car of ours out of the race, is absent). */
export type CircleOutput = { cars: Record<CarId, Circle> };
