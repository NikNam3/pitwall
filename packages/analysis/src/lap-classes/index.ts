// `lap-classes` (spec 4): the one definition of which laps count. A function, imported by the analyses that use it.
import type { LapRecord } from '@pitwall/domain';

/**
 * Which uses a lap counts for. `forPace`: valid, no in or out lap, `scShare` and `vscShare` 0, not lap 1 of a race.
 * `forRate`: no in or out lap, `scShare` and `vscShare` 0. `forBest`: per sector the sector is valid; the lap is valid.
 */
export type LapClass = { forPace: boolean; forRate: boolean; forBest: { lap: boolean; sectors: [boolean, boolean, boolean] } };

/** Classifies one lap record. */
export function classifyLap(_lap: LapRecord, _session: { isRace: boolean }): LapClass {
  throw new Error('not implemented');
}
