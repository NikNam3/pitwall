// Value type of the `ers` analysis (spec 5.3, A.3).
import type { Known } from '../known.ts';
import type { Joules } from '../units.ts';

/**
 * Whether the car can attack: the store is at or above the attack level (`ready`), or it rises towards it and gets
 * there in `inLaps` whole laps (rounded up, at least 1).
 */
export type ErsAttack = { ready: true } | { ready: false; inLaps: number };

/** `ers.car`: store, this lap's deployment and harvest, the trend, the laps until the attack level and the attack readiness. */
export type ErsState = {
  storeJ: Known<Joules>;
  capacityJ: Joules;
  deployedThisLapJ: Known<Joules>;
  /** The per-lap deploy limit. */
  deployLimitJ: Joules;
  harvestedThisLapJ: Known<Joules>;
  storeTrendJPerLap: Known<number>;
  /** The store an attack needs (config). */
  attackLevelJ: Joules;
  lapsToAttackLevel: Known<number>;
  /** Ready, or in whole laps while rising; `notApplicable` below the level while flat or falling, the trend's reason without one. */
  attack: Known<ErsAttack>;
  /** Published, not displayed. */
  mode: Known<'none' | 'medium' | 'hotlap' | 'overtake'>;
  /** Live, from the sign of the MGU-K power. */
  flow: Known<'deploying' | 'harvesting' | 'idle'>;
};
