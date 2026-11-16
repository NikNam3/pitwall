// What `degradation` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the situation; the calculator only looks up the session's and a car's rows. Its laps by activity come
// from the lap records (in and out laps, `lap-classes`).
import type { WeekendPhase } from '@pitwall/domain';
import { lapPhaseRowOf, RACE_LAP_PHASE_ROWS } from '../lap-classes/index.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';
import { IN_SESSION_ROWS } from '../shared/car-status.ts';

/** What the situations open for the session and a car say about its stints. */
export type DegradationEffect = {
  /**
   * The weekend phase is the race (spec 4.1): lap 1 is no pace lap (`lap-classes`), and a rival's fuel hidden by realism
   * is filled from our car's. In practice and qualifying (and `none`) neither: a hidden load stays unknown.
   */
  isRace?: boolean;
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
};

export const DEGRADATION_BEHAVIOUR: BehaviourTable<DegradationEffect> = {
  'weekend-phase': RACE_LAP_PHASE_ROWS,
  'car-status': IN_SESSION_ROWS,
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race (C14, `lapPhaseRowOf`). */
export const phaseRow = (phase: WeekendPhase['kind']): DegradationEffect => lapPhaseRowOf(RACE_LAP_PHASE_ROWS, phase);
