// What `sc-call` does per situation (contract C14, C43, C44, SP4.2 spec 3.3): one row per kind of every sub-machine it
// reads. The machine decided the situation; the calculator only looks up the row of the span open for the session.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations say about an SC call. */
export type ScCallEffect = {
  /** The weekend phase is the race: the rows are computed. */
  race?: boolean;
  /** The weekend phase is not the race (C14): our car is absent (`notApplicable` through the binding). */
  notApplicable?: boolean;
};

const RACE: ScCallEffect = { race: true };
const NOT_RACE: ScCallEffect = { notApplicable: true };

export const SC_CALL_BEHAVIOUR: BehaviourTable<ScCallEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race (C14). */
export const phaseRow = (phase: WeekendPhase['kind']): ScCallEffect =>
  (phase === 'pending' ? undefined : SC_CALL_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
