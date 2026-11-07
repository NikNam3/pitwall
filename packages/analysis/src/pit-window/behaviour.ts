// What `pit-window` does per situation (contract C14, C43, C44, SP4.2 spec 3.4): one row per kind of every sub-machine it
// reads. The machine decided the situation; the calculator only looks up the rows of the spans open (or, for a box stop
// since the stint start, closed) for our car and merges them.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations say about a car's pit window. */
export type PitWindowEffect = {
  /** The weekend phase is the race: the window is computed. */
  race?: boolean;
  /** The weekend phase is not the race (C14): our car's value is `notApplicable`. */
  notApplicable?: boolean;
  /** The compound rule is still to be met: the fitted compound is no option (K4) and a stop is mandatory. */
  ruleRequired?: boolean;
  /** The car stopped: a span of this kind opened since the stint start closes the window. */
  stopped?: boolean;
};

const IN: PitWindowEffect = {};
const RACE: PitWindowEffect = { race: true };
const NOT_RACE: PitWindowEffect = { notApplicable: true };

export const PIT_WINDOW_BEHAVIOUR: BehaviourTable<PitWindowEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
  'compound-rule': { required: { ruleRequired: true }, waived: IN },
  'car-activity-race': {
    racingLap: IN,
    inLap: IN,
    boxStop: { stopped: true },
    servingPenalty: IN,
    outLap: IN,
    finished: IN,
    coolDown: IN,
    notCompeting: IN,
  },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race (C14). */
export const phaseRow = (phase: WeekendPhase['kind']): PitWindowEffect =>
  (phase === 'pending' ? undefined : PIT_WINDOW_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
