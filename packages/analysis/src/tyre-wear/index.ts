// `tyre-wear` (spec 5.1): publishes the per-car topic `tyreWear.car`.
import type { CarId, TyreWear } from '@pitwall/domain';

export type { TyreWear } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const TYRE_WEAR = 'tyre-wear';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type TyreWearOutput = Record<CarId, TyreWear>;
