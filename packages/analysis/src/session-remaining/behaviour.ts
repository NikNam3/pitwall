// What `session-remaining` does per situation (contract C43, C44): the weekend phase says what the session runs on, the
// leader's race activity says whether the race is over for it.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** `basis` is what the session runs on (`none`: nothing applies, C14); `over` is the leader's race being over. */
export type SessionRemainingEffect = { basis?: 'laps' | 'time' | 'none'; over?: true };

const RUNNING: SessionRemainingEffect = {};
const OVER: SessionRemainingEffect = { over: true };

export const SESSION_REMAINING_BEHAVIOUR: BehaviourTable<SessionRemainingEffect> = {
  'weekend-phase': { practice: { basis: 'time' }, qualifying: { basis: 'time' }, race: { basis: 'laps' }, none: { basis: 'none' } },
  'car-activity-race': { racingLap: RUNNING, inLap: RUNNING, boxStop: RUNNING, servingPenalty: RUNNING, outLap: RUNNING, finished: OVER, coolDown: OVER, notCompeting: RUNNING },
};
