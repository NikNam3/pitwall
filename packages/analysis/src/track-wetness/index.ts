// `track-wetness` (SP4.3a spec 5.1): per lap and tyre type the field's common mode, and a filtered wetness state with
// its standard error. A calculator: no topic.
import type { TrackWetness } from '@pitwall/domain';

export { TRACK_WETNESS_BEHAVIOUR, type TrackWetnessEffect } from './behaviour.ts';
export * from './config.ts';
export { trackWetnessAsOf } from './asof.ts';

/** The calculator id. */
export const TRACK_WETNESS = 'track-wetness';

/** The output: the common mode per completed leader lap and the wetness state. */
export type TrackWetnessOutput = TrackWetness;
