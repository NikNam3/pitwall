// Defaults of `race-moment` (spec Appendix B). The battle moment's gap test uses `battle`'s `drsRangeMs`.
import { defineConfig } from '@pitwall/engine';

export const RACE_MOMENT_CONFIG = defineConfig('race-moment', {
  /** How long a major incident holds the incident moment. Source: research 06 §4. */
  incidentHoldMs: 30_000,
  /** A battle card with laps to DRS range at or below this sets the battle moment. Source: research 06 §4. */
  battleLaps: 2,
  /** Forecast rain chance from which the weather moment is set, in %. Source: pitwall estimate. */
  weatherRainPct: 40,
  /** How far ahead the forecast is read, in minutes. Source: pitwall estimate. */
  weatherHorizonMin: 10,
});
