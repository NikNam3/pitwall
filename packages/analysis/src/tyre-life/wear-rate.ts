// The wear rate of one corner over a run of laps (spec 4.2): the median of the rate laps' own wear gains
// (`per-lap-rate`). Shared by the calculator (the current set) and the priors (a source's stint), so both judge alike.
import type { Corners, Known, LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { classifyLap, type LapClassOptions } from '../lap-classes/index.ts';
import { perLapGainRate, type GainSample, type Rate, type RateOptions } from '../per-lap-rate/index.ts';

export const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const satisfies ReadonlyArray<keyof Corners<unknown>>;
export type Corner = (typeof CORNERS)[number];

/** The rate laps of `laps` (`lap-classes`' `forRate`); a rate lap has no lap-1 rule, so the weekend phase changes nothing. */
export function rateLaps<L extends DeepReadonly<LapRecord>>(laps: readonly L[], classes: Omit<LapClassOptions, 'isRace'>): L[] {
  const opts = { ...classes, isRace: false };
  return laps.filter((l) => classifyLap(l, opts).forRate);
}

/** The wear rate of `corner` in % per lap over rate laps `laps` (oldest first): a lap counts when both its samples are known. */
export function cornerRate(laps: readonly DeepReadonly<LapRecord>[], corner: Corner, opts: RateOptions): Known<Rate> {
  const samples: GainSample[] = [];
  for (const l of laps) {
    const start = l.wearAtStartPct[corner];
    const end = l.wearAtEndPct[corner];
    if (start.known && end.known) samples.push({ lap: l.lapNumber, gain: end.value - start.value, at: l.completedAt });
  }
  return perLapGainRate(samples, opts);
}
