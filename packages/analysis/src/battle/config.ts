// Defaults of `battle` (spec Appendix B). The DRS range is `race-interaction`'s `drsRangeMs`, the one DRS rule (C43).
import { defineConfig } from '@pitwall/engine/readers';

export const BATTLE_CONFIG = defineConfig('battle', {
  /** Pace advantage an overtake needs. Source: real F1, 1–2 s (research 06 §5 item 6). */
  overtakeThresholdMs: 1000,
  /** Fewer usable mini-sectors than this in the PACE Δ window give no pace delta (`insufficientData`): half a lap. Source: pitwall estimate. */
  minPaceSegments: 25,
});
