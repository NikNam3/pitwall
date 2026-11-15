// What `crossover` does per situation (contract C14, C43, C44, spec 3.4, B8): one row per kind of every sub-machine it
// reads. The machine decided the situation; the calculator only looks up the session's row and each lap's membership.
import type { WeekendPhase } from '@pitwall/domain';
import { lapPhaseRowOf, RACE_LAP_PHASE_ROWS, type LapPhaseKind } from '../lap-classes/index.ts';
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

/** The weekend-phase rows: `lap-classes`' (C43), and outside the race every field `notApplicable` (B8). */
const WEEKEND_PHASE_ROWS = {
  practice: { ...RACE_LAP_PHASE_ROWS.practice, notApplicable: true },
  qualifying: { ...RACE_LAP_PHASE_ROWS.qualifying, notApplicable: true },
  race: RACE_LAP_PHASE_ROWS.race,
  none: { ...RACE_LAP_PHASE_ROWS.none, notApplicable: true },
} as const satisfies Record<LapPhaseKind, CrossoverEffect>;

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
  'weekend-phase': WEEKEND_PHASE_ROWS,
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race (C14, `lapPhaseRowOf`). */
export const phaseRow = (phase: WeekendPhase['kind']): CrossoverEffect => lapPhaseRowOf(WEEKEND_PHASE_ROWS, phase);
