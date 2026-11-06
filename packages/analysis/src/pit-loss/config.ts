// Defaults of `pit-loss` (spec 4.3, 7).
import { defineConfig } from '@pitwall/engine/readers';

export const PIT_LOSS_CONFIG = defineConfig('pit-loss', {
  /** The clean `forPace` laps before a stop whose median is the car's reference lap. Source: TUM. */
  referenceLaps: 3,
  /** The prior's weight in stops (`k`) in the blend `(n · sessionMedian + k · prior) / (n + k)`. Source: pitwall estimate. */
  priorWeightStops: 2,
});
