// What `rival-stops` does per situation (contract C14, C43, C44, SP4.3a spec 5.3): one row per kind of every sub-machine
// it reads. The machine decided the situation; the calculator only looks up the rows of the spans open for a car and the
// session's weekend phase, and merges them.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car (and the session) say about its entry. */
export type RivalStopsEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
  /** The car no longer competes (retired, disqualified): no next stop, its fields `notApplicable`. */
  notCompeting?: boolean;
  /** The compound rule: the car still owes a stop (`required`) or not (`waived`). */
  owesStop?: boolean;
  /** The weekend phase is not the race: every field `notApplicable` (C14). */
  notApplicable?: boolean;
};

const IN: RivalStopsEffect = {};
const NOT_RACE: RivalStopsEffect = { notApplicable: true };

export const RIVAL_STOPS_BEHAVIOUR: BehaviourTable<RivalStopsEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: IN, none: NOT_RACE },
  'car-status': {
    competing: { inSession: true },
    retired: { inSession: true, notCompeting: true },
    disqualified: { inSession: true, notCompeting: true },
    absent: { inSession: false },
  },
  'compound-rule': { required: { owesStop: true }, waived: { owesStop: false } },
  // AI and human cars stop by the same peers and the same tyre life
  'car-driver': { ai: IN, human: IN },
};

/** The weekend-phase row of `phase`: a pending phase reads as the race's grid (C14), its row the race's. */
export const rivalStopsPhaseRow = (phase: WeekendPhase['kind']): RivalStopsEffect =>
  (phase === 'pending' ? undefined : RIVAL_STOPS_BEHAVIOUR['weekend-phase']?.[phase]) ?? IN;
