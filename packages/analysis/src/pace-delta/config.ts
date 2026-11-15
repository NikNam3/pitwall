// Defaults of `pace-delta` (spec 4): the pace window its callers (`damage`, `incidents`) measure a pace delta over.
import { defineConfig } from '@pitwall/engine/readers';

export const PACE_DELTA_CONFIG = defineConfig('pace-delta', {
  /** Pace laps in the recent mean. Source: pitwall estimate. */
  windowLaps: 3,
});
