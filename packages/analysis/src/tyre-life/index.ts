// `tyre-life` (spec 4.2; SP4.3c Task 12): a reader of `tyre-model`: per car its set's wear, rate and laps to the limit
// per corner. A calculator: no topic; `tyre-wear` publishes from it.
export * from './as-of.ts';
export * from './behaviour.ts';
export type { TyreLife, TyreLifeOutput } from './types.ts';

/** The calculator id. */
export const TYRE_LIFE = 'tyre-life';
