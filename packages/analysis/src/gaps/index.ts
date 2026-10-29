// `gaps` (spec 6.1): every gap from the mini-sector crossings; publishes `gaps.intervals`, `gaps.toCar`, `gaps.gapper`, `gaps.neighbourhood`.
import type { Known, CarId, Interval, Neighbourhood, SessionTime } from '@pitwall/domain';

export type { GapperLines, GapperReference, GapToCar, Interval, Neighbourhood } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const GAPS = 'gaps';

/**
 * The output. The bindings compute `gaps.toCar` and `gaps.gapper` from it with their params; `battle` reads
 * `intervals` for the gap now and `lineTimes` for its trend (the gap of A behind B at lap L is A's line time minus B's).
 */
export type GapsOutput = {
  intervals: Interval[];
  /** Per car, when it crossed the line at the end of each lap. */
  lineTimes: Record<CarId, { lap: number; at: SessionTime }[]>;
  /**
   * Per car, its last 100 crossings by progress (`(lap − 1) × 50 + segment`): `at[i]` is when it passed progress
   * `fromProgress + i` (a hole where none was recorded). Two laps, enough for the exact gap of any pair within a lap,
   * lapped ones included.
   */
  recent: Record<CarId, { fromProgress: number; at: SessionTime[] }>;
  neighbourhood: Neighbourhood[];
  /** When the race started (the lights-out event); the gapper counts each car's race time from it. `notApplicable` outside a race, `notReceived` before lights out. */
  raceStartAt: Known<SessionTime>;
};
