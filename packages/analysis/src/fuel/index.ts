// `fuel` (spec 5.2): publishes the per-car topic `fuel.car`.
import type { CarId, FuelState } from '@pitwall/domain';

export type { FuelState } from '@pitwall/domain';

/** The calculator id. */
export const FUEL = 'fuel';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type FuelOutput = Record<CarId, FuelState>;
