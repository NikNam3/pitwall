// What `pace` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open now and merges them. Its laps by
// activity come from the lap records (in and out laps).
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the weekend phase says about pace. */
export type PaceEffect = {
  /** Lap 1 is a standing start, no pace lap (`lap-classes`): only in a race. */
  isRace?: boolean;
  /** No pace applies (`none`, a time trial): every car's recent and stint pace is `notApplicable`, no samples. */
  notApplicable?: boolean;
};

const TIMED: PaceEffect = { isRace: false, notApplicable: false };

export const PACE_BEHAVIOUR: BehaviourTable<PaceEffect> = {
  'weekend-phase': { practice: TIMED, qualifying: TIMED, race: { isRace: true, notApplicable: false }, none: { isRace: false, notApplicable: true } },
};
