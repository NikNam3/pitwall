// The one wear rate per corner and the one wear/age basis (contract C43): `degradation`'s stints (`wearRatePctPerLap`,
// `basis`) and `tyre-life`'s corners (`ratePctPerLap`, `basis`) and priors all come from here, so they agree.
import type { Corners, Known, LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { isRateLap, type LapClassOptions } from '../lap-classes/index.ts';
import { perLapGainRate, type GainSample, type Rate, type RateOptions } from '../per-lap-rate/index.ts';

export const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const satisfies ReadonlyArray<keyof Corners<unknown>>;
export type Corner = (typeof CORNERS)[number];

/** What the wear rate is computed with: `lap-classes`' and `per-lap-rate`'s config. */
export type WearRateOptions = { lapClasses: Omit<LapClassOptions, 'isRace'>; rate: RateOptions };

/**
 * Per corner the wear rate in % per lap of a stint's laps (oldest first): the median (`per-lap-rate`) of the rate laps'
 * own wear gains (end minus start; `forRate`, which has no lap-1 rule), over each corner's newest `window` samples. A
 * lap whose start or end wear of a corner is unknown is no sample of that corner; a corner without enough samples is
 * `insufficientData`. A result is as of its newest sample's `completedAt`.
 */
export function wearRatePerCorner(laps: readonly DeepReadonly<LapRecord>[], o: WearRateOptions): Corners<Known<Rate>> {
  const { window } = o.rate;
  const fl: GainSample[] = [];
  const fr: GainSample[] = [];
  const rl: GainSample[] = [];
  const rr: GainSample[] = [];
  // one pass from the newest lap, each corner by name, until every corner holds `window` samples: older laps are outside
  // every window
  for (let i = laps.length - 1; i >= 0 && (fl.length < window || fr.length < window || rl.length < window || rr.length < window); i--) {
    const l = laps[i];
    if (l === undefined || !isRateLap(l, o.lapClasses)) continue;
    const start = l.wearAtStartPct;
    const end = l.wearAtEndPct;
    takeSample(fl, start.fl, end.fl, l, window);
    takeSample(fr, start.fr, end.fr, l, window);
    takeSample(rl, start.rl, end.rl, l, window);
    takeSample(rr, start.rr, end.rr, l, window);
  }
  return {
    fl: perLapGainRate(fl.reverse(), o.rate),
    fr: perLapGainRate(fr.reverse(), o.rate),
    rl: perLapGainRate(rl.reverse(), o.rate),
    rr: perLapGainRate(rr.reverse(), o.rate),
  };
}

/** Adds a lap's sample of one corner (its own gain, end minus start) when both are known and the window is not full. */
function takeSample(samples: GainSample[], start: DeepReadonly<Known<number>>, end: DeepReadonly<Known<number>>, l: DeepReadonly<LapRecord>, window: number): void {
  if (samples.length < window && start.known && end.known) samples.push({ lap: l.lapNumber, gain: end.value - start.value, at: l.completedAt });
}

/** The basis of a set's life: `wear` when every corner's wear is known, else `age`. */
export function wearBasis(wear: DeepReadonly<Corners<Known<number>>>): 'wear' | 'age' {
  return wear.fl.known && wear.fr.known && wear.rl.known && wear.rr.known ? 'wear' : 'age';
}
