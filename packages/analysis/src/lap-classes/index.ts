// `lap-classes` (spec 4): the one definition of which laps count. A function, imported by the analyses that use it.
import type { LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';

export * from './config.ts';

/**
 * Which uses a lap counts for. `forRate`: no in or out lap, neutralised time below `maxNeutralisedMs`. `forPace`: a
 * rate lap that is valid and not lap 1 of a race. `forBands`: a rate lap that is not lap 1 of a race; validity is not
 * required. `forBest`: per sector the sector is valid; the lap is valid.
 */
export type LapClass = { forPace: boolean; forRate: boolean; forBands: boolean; forBest: { lap: boolean; sectors: [boolean, boolean, boolean] } };

/** The session and the `lap-classes` config, as `classifyLap` needs them. */
export type LapClassOptions = { isRace: boolean; maxNeutralisedMs: number };

/** Time of the lap under SC or VSC, in ms. */
const neutralisedMs = (lap: DeepReadonly<LapRecord>): number => (lap.scShare + lap.vscShare) * lap.lapTimeMs;

/** Classifies one lap record. */
export function classifyLap(lap: DeepReadonly<LapRecord>, opts: LapClassOptions): LapClass {
  const forRate = !lap.inLap && !lap.outLap && neutralisedMs(lap) < opts.maxNeutralisedMs;
  const forBands = forRate && !(opts.isRace && lap.lapNumber === 1);
  const forPace = forBands && lap.valid.lap;
  return { forPace, forRate, forBands, forBest: { lap: lap.valid.lap, sectors: [...lap.valid.sectors] } };
}
