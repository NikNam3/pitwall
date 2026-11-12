// `pit-loss` (spec 4.3): the time a stop costs per condition (green, VSC, SC), the session's stops blended with the
// calibration (`view.priors`) or the track file's default. A calculator: no topic.
import type { PitLosses } from '@pitwall/domain';

// not `phaseRow`: degradation's carries that name in the package index
export { PIT_LOSS_BEHAVIOUR, type PitLossEffect } from './behaviour.ts';
export { pitLossAsOf } from './as-of.ts';
export * from './config.ts';
export * from './priors.ts';
export { stopLoss, type PitLossConfig, type PitLossOptions } from './loss.ts';

/** The calculator id. */
export const PIT_LOSS = 'pit-loss';

/** The output: per condition the loss with its source, and every car's stops of the session in lap order. */
export type PitLossOutput = PitLosses;
