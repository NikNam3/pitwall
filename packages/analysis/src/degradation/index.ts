// `degradation` (spec 4.1): tyre pace and degradation per lap, per car and stint, from a Kalman filter that starts from
// the calibration (`view.priors`) or a default and takes over from the session's laps. A calculator: no topic. The
// calculator itself is exported from the package index (`calculator.ts`).
export * from './behaviour.ts';
export * from './config.ts';
export { fitStint, type FilterLap, type FilterPrior, type StintFitResult } from './kalman.ts';
export { DEGRADATION_PRIORS } from './priors.ts';
export type { DegradationLap, DegradationOutput, StartPrior, StintDegradation } from './types.ts';

/** The calculator id. */
export const DEGRADATION = 'degradation';
