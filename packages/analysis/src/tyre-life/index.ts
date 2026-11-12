// `tyre-life` (spec 4.2): laps until the current set reaches its limit, and the fresh-set life per compound, from the
// wear rates (wear basis) or `degradation`'s `ν` (age basis). A calculator: no topic; `tyre-wear` publishes from it.
export * from './as-of.ts';
export * from './behaviour.ts';
export * from './config.ts';
export * from './priors.ts';
export type { TyreLife, TyreLifeOutput } from './types.ts';

/** The calculator id. */
export const TYRE_LIFE = 'tyre-life';
