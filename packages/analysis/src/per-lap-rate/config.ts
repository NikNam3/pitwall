// Defaults of `per-lap-rate` (spec Appendix B); the analyses that call `perLapGainRate` read them and pass them as `opts`.
import { defineConfig } from '@pitwall/engine';

export const PER_LAP_RATE_CONFIG = defineConfig('per-lap-rate', {
  /** Gain samples (laps) the median is taken over, the newest last. Source: pitwall estimate. */
  window: 5,
  /** Fewer samples than this give `insufficientData`: a lap's own gain needs no second lap to be a rate. Source: user ruling 2026-10-30. */
  minSamples: 2,
});
