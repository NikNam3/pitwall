// Defaults of `weekend-pace` (SP4.3d2 Task 6b, call 9): each car's race pace from the weekend's practice and qualifying.
// Measured once on the one stored weekend with practice, qualifying and a race: Texas, 2026-11-04/05 (short practice
// 2026-11-04_23-32-45, one-shot qualifying 2026-11-05_00-05-11, race 2026-11-05_00-13-26; 20 cars), reprocessed.
import { defineConfig } from '@pitwall/engine/readers';

export const WEEKEND_PACE_CONFIG = defineConfig('weekend-pace', {
  /**
   * A practice stint with fewer pace laps (fuel known) is no long run. Source: reasoned, not measured. The Texas short
   * practice has no stint over 6 pace laps (Antonelli hards 6, every other ≤ 5), so it holds no long run. In the race,
   * the first stints of 6–10 pace laps gave per-car fitted slopes from −38 to 446 ms/lap. A stint of at least 8 laps
   * keeps the tyre-age term from being fitted on a handful of laps.
   */
  minLongRunLaps: 8,
  /**
   * The race's pace against the raw qualifying best (ms; ruling R5): per car, its race's first green stint on
   * degradation's basis (lap time − 30 ms/kg · fuel, at tyre age 0 by the stint's least-squares slope, moved to medium
   * by the track file's offsets) minus its best valid qualifying lap. Source: Texas 2026-11-05, 20 cars, median 3006
   * (mean 2987, range 1505–4672).
   */
  raceTrimOffsetMs: 3000,
  /**
   * The sd of a pace taken from qualifying (ms): the spread over the cars of the measured offset above. Source: Texas
   * 2026-11-05, 20 cars, sd 876 (MAD-σ 996).
   */
  qualifyingPaceSdMs: 900,
});
