// Defaults of `rain-outlook` (spec 3.3, 8): moved from `race-moment` (C43).
import { defineConfig } from '@pitwall/engine/readers';

export const RAIN_OUTLOOK_CONFIG = defineConfig('rain-outlook', {
  /** Forecast rain chance from which a sample counts as rain, in %. Source: pitwall estimate. */
  rainPct: 40,
  /** How far ahead rain counts as coming, in minutes. Source: pitwall estimate. */
  horizonMin: 10,
});
