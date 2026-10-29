// `car-bands` (spec 5.4): publishes the per-car topic `carBands.car`.
import type { CarId, CarBands } from '@pitwall/domain';

export type { BandReading, BandState, CarBands } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const CAR_BANDS = 'car-bands';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type CarBandsOutput = Record<CarId, CarBands>;
