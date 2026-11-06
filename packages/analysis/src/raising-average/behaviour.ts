// What `raising-average` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads.
// The machine decided the weekend phase; the analysis only looks up its row. The rows follow degradation's: lap 1 of a
// race is no pace lap (`lap-classes`); `none` (a time trial or an unknown session type) computes as practice.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the weekend phase says about a session's pace laps: in the race, lap 1 is none. */
export type RaisingAverageEffect = { isRace?: true };

const RACE: RaisingAverageEffect = { isRace: true };
const NOT_RACE: RaisingAverageEffect = {};

export const RAISING_AVERAGE_BEHAVIOUR: BehaviourTable<RaisingAverageEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race's grid (C14), its row the race's. */
export const phaseRow = (phase: WeekendPhase['kind']): RaisingAverageEffect =>
  (phase === 'pending' ? undefined : RAISING_AVERAGE_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
