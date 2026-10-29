// `ers` (spec 5.3): publishes the per-car topic `ers.car`.
import type { CarId, ErsState } from '@pitwall/domain';

export type { ErsState } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const ERS = 'ers';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type ErsOutput = Record<CarId, ErsState>;
