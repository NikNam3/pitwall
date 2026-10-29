// `per-lap-rate` (spec 4): a robust per-lap slope and the laps until a target. A function, imported by the analyses that use it.
import { known, unknown, type Known, type SessionTime } from '@pitwall/domain';

export * from './config.ts';

/** A per-lap rate in the samples' unit per lap, and how many samples it rests on. */
export type Rate = { perLap: number; samples: number };

/** A sample of a per-lap value; `at` is the session time it was taken (the lap's completion). The result's `at` is the newest used sample's. */
export type RateSample = { lap: number; value: number; at: SessionTime };

/**
 * Theil–Sen slope (median of the pairwise slopes) of the last `window` samples (sorted by lap, newest last);
 * `unknown('insufficientData')` below `minSamples`.
 */
export function perLapRate(samples: RateSample[], opts: { window: number; minSamples: number }): Known<Rate> {
  const used = opts.window > 0 ? samples.slice(-opts.window) : [];
  const newest = used[used.length - 1];
  if (newest === undefined || used.length < opts.minSamples) return unknown('insufficientData');
  const slopes: number[] = [];
  used.forEach((a, i) => {
    for (const b of used.slice(i + 1)) {
      if (b.lap !== a.lap) slopes.push((b.value - a.value) / (b.lap - a.lap));
    }
  });
  if (slopes.length === 0) return unknown('insufficientData');
  return known({ perLap: median(slopes), samples: used.length }, newest.at);
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

/** Laps until the value reaches `target` at `rate`; `notApplicable` when the rate moves away from it. A known result carries the rate's `at`. */
export function lapsUntil(rate: Known<Rate>, now: number, target: number): Known<number> {
  if (!rate.known) return rate;
  if (now === target) return known(0, rate.at);
  const laps = (target - now) / rate.value.perLap;
  return Number.isFinite(laps) && laps > 0 ? known(laps, rate.at) : unknown('notApplicable');
}
