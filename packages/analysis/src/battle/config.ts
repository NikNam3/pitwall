// Defaults of `battle` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const BATTLE_CONFIG = defineConfig('battle', {
  /** DRS detection: within one second of the car ahead. Source: FIA Formula 1 Sporting Regulations. */
  drsRangeMs: 1000,
  /** Pace advantage an overtake needs. Source: real F1, 1–2 s (research 06 §5 item 6). */
  overtakeThresholdMs: 1000,
});
