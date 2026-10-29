// `lap-classes` (spec 4): the one definition of which laps count. A function, imported by the analyses that use it.
import type { LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine';

/**
 * Which uses a lap counts for. `forPace`: valid, no in or out lap, `scShare` and `vscShare` 0, not lap 1 of a race.
 * `forRate`: no in or out lap, `scShare` and `vscShare` 0. `forBest`: per sector the sector is valid; the lap is valid.
 */
export type LapClass = { forPace: boolean; forRate: boolean; forBest: { lap: boolean; sectors: [boolean, boolean, boolean] } };

/** Classifies one lap record. */
export function classifyLap(lap: DeepReadonly<LapRecord>, session: { isRace: boolean }): LapClass {
  const forRate = !lap.inLap && !lap.outLap && lap.scShare === 0 && lap.vscShare === 0;
  const forPace = forRate && lap.valid.lap && !(session.isRace && lap.lapNumber === 1);
  return { forPace, forRate, forBest: { lap: lap.valid.lap, sectors: [...lap.valid.sectors] } };
}
