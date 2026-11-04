// What `fuel` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them. Its laps by
// activity come from the lap records (in and out laps), and a rate has no lap-1 rule.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car say about its fuel state. */
export type FuelEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
  /**
   * The weekend phase has a burn to judge: the burn and what follows from it (laps of fuel, margin, save target). Without
   * one (`none`, a time trial) they are `notApplicable`; the readings stay.
   */
  judged?: boolean;
};

const IN: FuelEffect = { inSession: true };
const JUDGED: FuelEffect = { judged: true };

export const FUEL_BEHAVIOUR: BehaviourTable<FuelEffect> = {
  'weekend-phase': { practice: JUDGED, qualifying: JUDGED, race: JUDGED, none: { judged: false } },
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
};
