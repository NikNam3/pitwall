// What `pit-loss` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the weekend phase; the calculator and the priors aggregate only look up its row. Spec 4.3 names no
// phase: the rows follow degradation's, `none` (a time trial or an unknown session type) computing as practice.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the weekend phase says about a session's stops. */
export type PitLossEffect = {
  /** The weekend phase is the race: lap 1 is no reference lap (`lap-classes`). In practice, qualifying and `none` it is. */
  isRace?: boolean;
};

const RACE: PitLossEffect = { isRace: true };
const NOT_RACE: PitLossEffect = { isRace: false };

export const PIT_LOSS_BEHAVIOUR: BehaviourTable<PitLossEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race's grid (C14), its row the race's. */
export const phaseRow = (phase: WeekendPhase['kind']): PitLossEffect =>
  (phase === 'pending' ? undefined : PIT_LOSS_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
