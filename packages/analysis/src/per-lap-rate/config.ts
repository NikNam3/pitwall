// Defaults of `per-lap-rate` (spec Appendix B); the analyses that call `perLapRate` read them and pass them as `opts`.
import { defineConfig } from '@pitwall/engine';

export const PER_LAP_RATE_CONFIG = defineConfig('per-lap-rate', {
  /** Samples (laps) the slope is taken over, the newest last. Source: pitwall estimate. */
  window: 5,
  /** Fewer samples than this give `insufficientData`. Source: pitwall estimate. */
  minSamples: 3,
});
