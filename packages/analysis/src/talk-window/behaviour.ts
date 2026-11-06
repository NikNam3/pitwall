// What `talk-window` does per situation (contract C43, C44): one row per kind of `car-location`.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What a car's location says about its entry. */
export type TalkWindowEffect = { talk: 'byZones' | 'clear' | 'notApplicable' };

export const TALK_WINDOW_BEHAVIOUR: BehaviourTable<TalkWindowEffect> = {
  'car-location': { garage: { talk: 'notApplicable' }, pitLane: { talk: 'clear' }, track: { talk: 'byZones' } },
};
