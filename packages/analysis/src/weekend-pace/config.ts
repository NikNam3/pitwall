// Defaults of `weekend-pace` (SP4.3d2 Task 6b, call 9): each car's race pace from the weekend's practice and qualifying.
import { defineConfig } from '@pitwall/engine/readers';

export const WEEKEND_PACE_CONFIG = defineConfig('weekend-pace', {
  /** A practice stint with fewer green `forPace` laps is no long run. Source: provisional; Task 6b measures it. */
  minLongRunLaps: 6,
  /** The race's pace against the corrected qualifying best (ms; the race trim and the tyre's age). Source: provisional; Task 6b measures it. */
  raceTrimOffsetMs: 1500,
  /** The sd of a pace taken from qualifying (ms). Source: provisional; Task 6b measures it. */
  qualifyingPaceSdMs: 400,
});
