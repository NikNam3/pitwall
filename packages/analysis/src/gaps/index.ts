// `gaps` (spec 6.1): every gap from the mini-sector crossings; publishes `gaps.intervals`, `gaps.toCar`, `gaps.gapper`, `gaps.neighbourhood`.
import type { CarId, Interval, Neighbourhood, SessionTime } from '@pitwall/domain';

export type { GapperLines, GapperReference, GapToCar, Interval, Neighbourhood } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const GAPS = 'gaps';

/**
 * The output. The bindings compute `gaps.toCar` and `gaps.gapper` from it with their params; `battle` reads
 * `lineTimes` (the gap of A behind B at lap L is A's line time minus B's) and `latest` for the gap now.
 */
export type GapsOutput = {
  intervals: Interval[];
  /** Per car, when it crossed the line at the end of each lap. */
  lineTimes: Record<CarId, { lap: number; at: SessionTime }[]>;
  /** Per car, its latest mini-sector crossing. */
  latest: Record<CarId, { lap: number; segment: number; at: SessionTime }>;
  neighbourhood: Neighbourhood[];
};
