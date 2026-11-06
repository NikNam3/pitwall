// What `degradation` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up a car's rows. Its laps by activity come from the lap records (in
// and out laps, `lap-classes`), and the weekend phase is the view's (C14), so it reads car-status only.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car say about its entry. */
export type DegradationEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
};

const IN: DegradationEffect = { inSession: true };

export const DEGRADATION_BEHAVIOUR: BehaviourTable<DegradationEffect> = {
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
};
