// `pit-losses` (spec 5): publishes `pitLosses.track`, the pit loss per condition and this session's stops from `pit-loss`.
import type { PitLosses } from '@pitwall/domain';

export type { PitLosses } from '@pitwall/domain';

/** The analysis id. */
export const PIT_LOSSES = 'pit-losses';

/** The output: the topic's value. */
export type PitLossesOutput = PitLosses;
