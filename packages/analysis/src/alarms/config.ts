// Defaults of `alarms` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const ALARMS_CONFIG = defineConfig('alarms', {
  /** Laps until the wear limit below which the wear alarm is raised. Source: pitwall estimate. */
  wearLapsWarning: 3,
  /** Corner-cutting warnings before a penalty. Source: F1 25 default setting (unverified; real F1 usually allows three); league rule open. */
  warningsBeforePenalty: 3,
});
