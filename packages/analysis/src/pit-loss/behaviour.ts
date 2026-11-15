// What `pit-loss` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the weekend phase; the calculator and the priors aggregate only look up its row. Spec 4.3 names no
// phase: the rows follow degradation's, `none` (a time trial or an unknown session type) computing as practice.
import type { WeekendPhase } from '@pitwall/domain';
import { lapPhaseRowOf, RACE_LAP_PHASE_ROWS } from '../lap-classes/index.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the weekend phase says about a session's stops. */
export type PitLossEffect = {
  /** The weekend phase is the race: lap 1 is no reference lap (`lap-classes`). In practice, qualifying and `none` it is. */
  isRace?: boolean;
};

export const PIT_LOSS_BEHAVIOUR: BehaviourTable<PitLossEffect> = {
  'weekend-phase': RACE_LAP_PHASE_ROWS,
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race (C14, `lapPhaseRowOf`). */
export const phaseRow = (phase: WeekendPhase['kind']): PitLossEffect => lapPhaseRowOf(RACE_LAP_PHASE_ROWS, phase);
