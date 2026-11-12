// `race-hazard` as of a frame (SP4.3b spec §5.2): a pure function of the `AsOfView`, for `forecast-score` and the jobs.
import type { RaceHazard } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';

/** The remaining race's SC and VSC chances per lap, their durations and the one out now, as of `view`'s frame. */
export function raceHazardAsOf(_view: AsOfView): RaceHazard {
  throw new Error('not implemented');
}
