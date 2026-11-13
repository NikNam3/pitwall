// Defaults of `pit-loss` (spec 4.3, 7).
import { defineConfig } from '@pitwall/engine/readers';

export const PIT_LOSS_CONFIG = defineConfig('pit-loss', {
  /** The clean `forPace` laps before a stop whose median is the car's reference lap. Source: TUM. */
  referenceLaps: 3,
  /** The prior's weight in stops (`k`) in the blend `(n · sessionMedian + k · prior) / (n + k)`. Source: pitwall estimate. */
  priorWeightStops: 2,
  /**
   * The prior of the in-lap's share of a stop's loss, blended with the session's stops as the loss is (SP4.3b Task 11c):
   * 0.26 = 5.5 s of F1 25's 21.5 s green stop. Source: research 12 §5. Used where the track file has no
   * `defaults.pitLossInLapShare` (SP4.3b Task 26).
   */
  inLapShare: 0.26,
});
