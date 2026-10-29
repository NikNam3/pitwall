// `per-lap-rate` (spec 4): a robust per-lap slope and the laps until a target. A function, imported by the analyses that use it.
import type { Known } from '@pitwall/domain';

export * from './config.ts';

/** A per-lap rate in the samples' unit per lap, and how many samples it rests on. */
export type Rate = { perLap: number; samples: number };

/**
 * Theil–Sen slope (median of the pairwise slopes) of the last `window` samples; `unknown('insufficientData')` below
 * `minSamples`.
 */
export function perLapRate(_samples: { lap: number; value: number }[], _opts: { window: number; minSamples: number }): Known<Rate> {
  throw new Error('not implemented');
}

/** Laps until the value reaches `target` from `now` at `rate`; `notApplicable` when the rate moves away from it. */
export function lapsUntil(_rate: Known<Rate>, _now: number, _target: number): Known<number> {
  throw new Error('not implemented');
}
