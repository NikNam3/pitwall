// `damage` (spec 5.5): publishes the per-car topic `damage.car`.
import type { CarId, DamageState } from '@pitwall/domain';

export type { DamageJump, DamageParts, DamageState } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const DAMAGE = 'damage';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type DamageOutput = Record<CarId, DamageState>;
