// `per-lap-rate` (spec 4): robust per-lap rates and the laps until a target. Functions, imported by the analyses that use them.
import { known, unknown, type Known, type SessionTime } from '@pitwall/domain';

export * from './config.ts';

/** A per-lap rate in the samples' unit per lap, and how many samples it rests on. */
export type Rate = { perLap: number; samples: number };

/** Sizes of a rate's sample window. */
export type RateOptions = { window: number; minSamples: number };

/** The last `window` samples, newest last; `undefined` when they are fewer than `minSamples` or none. */
function windowOf<S>(samples: readonly S[], opts: RateOptions): S[] | undefined {
  const used = opts.window > 0 ? samples.slice(-opts.window) : [];
  return used.length > 0 && used.length >= opts.minSamples ? used : undefined;
}

/** One lap's own change of a value (its end sample against its start sample); `at` is the lap's completion. */
export type GainSample = { lap: number; gain: number; at: SessionTime };

/**
 * The median of the last `window` gains (sorted by lap, newest last), as of the newest; `unknown('insufficientData')`
 * below `minSamples`. A lap's gain is its own, so laps that are no samples leave nothing behind in the rate.
 */
export function perLapGainRate(samples: GainSample[], opts: RateOptions): Known<Rate> {
  const used = windowOf(samples, opts);
  const newest = used?.at(-1);
  if (used === undefined || newest === undefined) return unknown('insufficientData');
  return known({ perLap: median(used.map((s) => s.gain)), samples: used.length }, newest.at);
}

/** A value sampled once a lap, e.g. a gap at the line; `at` is when it was taken. The result's `at` is the newest used sample's. */
export type RateSample = { lap: number; value: number; at: SessionTime };

/**
 * Theil–Sen slope (median of the pairwise slopes) of the last `window` samples (sorted by lap, newest last);
 * `unknown('insufficientData')` below `minSamples`. For values sampled at the line that no lap owns, such as a gap.
 */
export function perLapRate(samples: RateSample[], opts: RateOptions): Known<Rate> {
  const used = windowOf(samples, opts);
  const newest = used?.at(-1);
  if (used === undefined || newest === undefined) return unknown('insufficientData');
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

/**
 * Laps until a reading reaches `target`: 0 once it is there (at or above `target` for `rising`, at or below for
 * `falling`), as of the reading and whatever the rate, so a limit that has been passed stays reached; before that,
 * `lapsUntil`.
 */
export function lapsToReach(
  rate: Known<Rate>,
  reading: { value: number; at: SessionTime },
  target: number,
  direction: 'rising' | 'falling',
): Known<number> {
  const reached = direction === 'rising' ? reading.value >= target : reading.value <= target;
  return reached ? known(0, reading.at) : lapsUntil(rate, reading.value, target);
}
