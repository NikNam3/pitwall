// `crossover` (spec 3.4): publishes `crossover.car`, the field's lap times per tyre type against our car's; race only (B8).
import type { CarId, Crossover } from '@pitwall/domain';

export type { Crossover, CrossoverLap, FirstFaster, TyreType } from '@pitwall/domain';
export { CROSSOVER_BEHAVIOUR, type CrossoverEffect } from './behaviour.ts';
export * from './config.ts';
export { tyreTypeOf } from './tyre-type.ts';

/** The analysis id. */
export const CROSSOVER = 'crossover';

/** The output: the topic's value for each of our cars; a rival is absent (`notApplicable` through the binding). */
export type CrossoverOutput = Record<CarId, Crossover>;
