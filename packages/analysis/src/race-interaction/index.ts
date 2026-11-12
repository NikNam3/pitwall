// `race-interaction` (SP4.3a spec 5.4): the pass curve per difficulty band, the DRS pass factor and straight gain, the
// minimum following gap, the time the car ahead loses while held, the rejoin push-back and dirty air. A calculator: no topic.
// The calculator itself is exported from the package index (`calculator.ts`).
import type { RaceInteraction } from '@pitwall/domain';

export { RACE_INTERACTION_BEHAVIOUR, type RaceInteractionEffect } from './behaviour.ts';
export * from './config.ts';
export { raceInteractionAsOf } from './asof.ts';
export { excludedLap, followingEpisodes, type EpisodeZone, type FollowingEpisode, type LapFilterCtx } from './episodes.ts';
export { fitPassCurve } from './fit.ts';
export { passLevelKey, passSlopeKey, RACE_INTERACTION_PRIORS } from './priors.ts';

/** The calculator id. */
export const RACE_INTERACTION = 'race-interaction';

/** The output: the interaction parameters of the track and session. */
export type RaceInteractionOutput = RaceInteraction;
