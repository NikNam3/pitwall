// Defaults of `pace-delta` (spec 4): the pace window its callers measure a pace delta (`damage`, `incidents`) or the
// reference pace before a stop (`pit-loss`, SP4.3c O12) over.
import { defineConfig } from '@pitwall/engine/readers';

export const PACE_DELTA_CONFIG = defineConfig('pace-delta', {
  /** Pace laps in the recent mean. Source: pitwall estimate. */
  windowLaps: 3,
});
