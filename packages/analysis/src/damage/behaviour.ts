// What `damage` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them. Its pace
// laps by activity come from the lap records (in and out laps).
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car say about its damage; every field absent means "no change". */
export type DamageEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
  /** Lap 1 is a standing start, no pace lap for a jump's loss (`lap-classes`): only in a race. */
  isRace?: boolean;
  /** A jump's loss can be measured: not without a weekend phase (`none`, a time trial), where it is `notApplicable`. */
  measured?: boolean;
};

const IN: DamageEffect = { inSession: true };
const TIMED: DamageEffect = { isRace: false, measured: true };
/** Wherever the car is, its damage is live: a repair in the garage or the pit lane shows at once, as on track. */
const LIVE: DamageEffect = {};

export const DAMAGE_BEHAVIOUR: BehaviourTable<DamageEffect> = {
  'weekend-phase': { practice: TIMED, qualifying: TIMED, race: { isRace: true, measured: true }, none: { isRace: false, measured: false } },
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
  'car-location': { garage: LIVE, pitLane: LIVE, track: LIVE },
};
