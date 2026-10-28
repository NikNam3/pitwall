// Which game packet a value came from, and how often that packet is expected. The UI decides when a value is stale.
import type { Ms } from './units.ts';

/** A packet type of the game that updates a car: the keys of `CarState.updatedAt`. */
export type DataSource =
  | 'lapData'
  | 'motion'
  | 'telemetry'
  | 'status'
  | 'motionEx'
  | 'damage'
  | 'tyreSets'
  | 'sessionHistory'
  | 'participants'
  | 'setups';

/**
 * The expected interval between two updates of a car by each source (F1 25 spec). The five menu-rate sources send
 * at the rate the player set in the game menu, so they use the measured cadence (`feed.status.cadenceMs`) instead.
 * The UI applies its own factor ("stale after about 3 missed updates") to either interval.
 * `tyreSets` and `sessionHistory` rotate over up to 22 cars at 20 packets per second.
 */
export const SOURCE_INTERVAL_MS: Record<DataSource, Ms | 'menuRate'> = {
  lapData: 'menuRate',
  motion: 'menuRate',
  telemetry: 'menuRate',
  status: 'menuRate',
  motionEx: 'menuRate',
  damage: 100,
  setups: 500,
  participants: 5000,
  tyreSets: 1100,
  sessionHistory: 1100,
};
