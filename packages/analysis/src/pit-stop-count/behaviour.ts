// What `pit-stop-count` does per situation (contract C43, C44): car-status says whether a car is one of the session's.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** `listed`: a car with a span of this kind, open or closed, is one of the session's and has its count. */
export type PitStopCountEffect = { listed: boolean };

const LISTED: PitStopCountEffect = { listed: true };

export const PIT_STOP_COUNT_BEHAVIOUR: BehaviourTable<PitStopCountEffect> = {
  // an empty grid slot is `absent` only; a car that left the session keeps its earlier spans, so it stays listed
  'car-status': { competing: LISTED, retired: LISTED, disqualified: LISTED, absent: { listed: false } },
};
