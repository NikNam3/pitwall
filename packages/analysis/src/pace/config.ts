// Defaults of `pace` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const PACE_CONFIG = defineConfig('pace', {
  /** Pace laps in the recent mean. Source: pitwall estimate. */
  window: 3,
});
