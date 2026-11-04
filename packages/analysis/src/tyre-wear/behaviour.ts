// What `tyre-wear` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them. Its laps by
// activity come from the lap records (in and out laps), and a rate has no lap-1 rule, so it reads no weekend phase.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car say about its entry. */
export type TyreWearEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
};

const IN: TyreWearEffect = { inSession: true };

export const TYRE_WEAR_BEHAVIOUR: BehaviourTable<TyreWearEffect> = {
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
};
