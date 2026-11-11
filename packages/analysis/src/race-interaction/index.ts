// `race-interaction` (SP4.3a spec 5.4): the pass curve per difficulty band, the DRS pass factor and straight gain, the
// minimum following gap, the time the car ahead loses while held, the rejoin push-back and dirty air. A calculator: no topic.
import type { RaceInteraction } from '@pitwall/domain';

export * from './config.ts';
export { raceInteractionAsOf } from './asof.ts';

/** The calculator id. */
export const RACE_INTERACTION = 'race-interaction';

/** The output: the interaction parameters of the track and session. */
export type RaceInteractionOutput = RaceInteraction;
