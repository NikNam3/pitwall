// Value type of the `ers` analysis (spec 5.3, A.3).
import type { Known } from '../known.ts';
import type { Joules } from '../units.ts';

/** `ers.car`: store, this lap's deployment and harvest, the trend and the laps until the attack level. */
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
  /** Published, not displayed. */
  mode: Known<'none' | 'medium' | 'hotlap' | 'overtake'>;
  /** Live, from the sign of the MGU-K power. */
  flow: Known<'deploying' | 'harvesting' | 'idle'>;
};
