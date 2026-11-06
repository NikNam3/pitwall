// `lap-classes` (spec 4): the one definition of which laps count. Functions, imported by the analyses that use it.
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

/** Whether a lap counts for rates: `classifyLap(lap, opts).forRate`, without building the class. */
export function isRateLap(lap: DeepReadonly<LapRecord>, opts: Pick<LapClassOptions, 'maxNeutralisedMs'>): boolean {
  return !lap.inLap && !lap.outLap && neutralisedMs(lap) < opts.maxNeutralisedMs;
}

/** Whether a rate lap (`forRate`) counts for bands: it is not lap 1 of a race. */
const bandsOf = (lap: DeepReadonly<LapRecord>, opts: LapClassOptions, forRate: boolean): boolean => forRate && !(opts.isRace && lap.lapNumber === 1);

/** Whether a lap counts for pace: `classifyLap(lap, opts).forPace`, without building the class. */
export function isPaceLap(lap: DeepReadonly<LapRecord>, opts: LapClassOptions): boolean {
  return bandsOf(lap, opts, isRateLap(lap, opts)) && lap.valid.lap;
}

/** Classifies one lap record. */
export function classifyLap(lap: DeepReadonly<LapRecord>, opts: LapClassOptions): LapClass {
  const forRate = isRateLap(lap, opts);
  const forBands = bandsOf(lap, opts, forRate);
  const forPace = forBands && lap.valid.lap;
  const s = lap.valid.sectors;
  return { forPace, forRate, forBands, forBest: { lap: lap.valid.lap, sectors: [s[0], s[1], s[2]] } };
}
