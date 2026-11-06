// Defaults of `race-moment` (spec Appendix B). The battle moment's gap test uses `battle`'s `drsRangeMs`; the weather moment's thresholds are `rain-outlook`'s.
import { defineConfig } from '@pitwall/engine/readers';

export const RACE_MOMENT_CONFIG = defineConfig('race-moment', {
  /** How long a major incident holds the incident moment. Source: research 06 §4. */
  incidentHoldMs: 30_000,
  /** A battle card with laps to DRS range at or below this sets the battle moment. Source: research 06 §4. */
  battleLaps: 2,
});
