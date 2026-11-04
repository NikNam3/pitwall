// Battle's behaviour table (contract C44): what battle computes for each kind of the sub-machines it reads.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the weekend phase allows: battle cards are computed in a race only. */
export type PhaseBehaviour = { cards: 'computed' | 'notApplicable' };
/** What race control allows: `enabled` DRS, or `disabled` with the reason of the span's detail. */
export type DrsBehaviour = { drs: 'enabled' | 'disabled' };
export type BattleBehaviour = PhaseBehaviour | DrsBehaviour;

/** One row per kind of `weekend-phase` and `race-control-race` (C44). `none` is `notApplicable` (C14). */
export const BATTLE_BEHAVIOUR = {
  'weekend-phase': {
    race: { cards: 'computed' },
    practice: { cards: 'notApplicable' },
    qualifying: { cards: 'notApplicable' },
    none: { cards: 'notApplicable' },
  },
  'race-control-race': {
    drsOn: { drs: 'enabled' },
    drsOff: { drs: 'disabled' },
  },
} as const satisfies BehaviourTable<BattleBehaviour>;
