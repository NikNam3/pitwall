// What `degradation` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the situation; the calculator only looks up the session's and a car's rows. Its laps by activity come
// from the lap records (in and out laps, `lap-classes`).
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

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

const IN: DegradationEffect = { inSession: true };
const RACE: DegradationEffect = { isRace: true };
const NOT_RACE: DegradationEffect = { isRace: false };

export const DEGRADATION_BEHAVIOUR: BehaviourTable<DegradationEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race's grid (C14), its row the race's. */
export const phaseRow = (phase: WeekendPhase['kind']): DegradationEffect =>
  (phase === 'pending' ? undefined : DEGRADATION_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
