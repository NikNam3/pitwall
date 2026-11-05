// Defaults of `alarms` (spec Appendix B).
import { defineConfig } from '@pitwall/engine/readers';

export const ALARMS_CONFIG = defineConfig('alarms', {
  /** Laps until the wear limit below which the wear alarm is raised. Source: pitwall estimate. */
  wearLapsWarning: 3,
  /**
   * Corner-cutting warnings before a penalty, in a race; the last-warning alarm fires at one less. Source: F1 25 recordings
   * 2026-10-29/30: the 'multiple warnings' time penalty (infringement 21) came with the 3rd corner-cutting warning in 3 of
   * 3 races; practice reached 9 without a penalty (scan-situations --warnings, 2026-11-05).
   */
  warningsBeforePenalty: 3,
});
