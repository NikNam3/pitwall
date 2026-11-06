// What `crossover` does per situation (contract C14, C43, C44, spec 3.4, B8): one row per kind of every sub-machine it
// reads. The machine decided the situation; the calculator only looks up the session's row and each lap's membership.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations say about the crossover. */
export type CrossoverEffect = {
  /** The weekend phase is the race: the crossover is computed, and lap 1 is no pace lap (`lap-classes`). */
  isRace?: boolean;
  /** The weekend phase is not the race (B8): every field is `notApplicable`. */
  notApplicable?: boolean;
  /** A lap whose membership holds this kind is no green lap. */
  excluded?: boolean;
};

const IN: CrossoverEffect = {};
const RACE: CrossoverEffect = { isRace: true };
const NOT_RACE: CrossoverEffect = { notApplicable: true };

export const CROSSOVER_BEHAVIOUR: BehaviourTable<CrossoverEffect> = {
  'session-phase-race': {
    grid: IN,
    formation: IN,
    startLights: IN,
    racing: IN,
    neutralised: IN,
    suspended: { excluded: true },
    finished: IN,
    postSession: IN,
  },
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race's grid (C14), its row the race's. */
export const phaseRow = (phase: WeekendPhase['kind']): CrossoverEffect =>
  (phase === 'pending' ? undefined : CROSSOVER_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
