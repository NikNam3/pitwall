// Defaults of `battle` (spec Appendix B).
import { defineConfig } from '@pitwall/engine/readers';

export const BATTLE_CONFIG = defineConfig('battle', {
  /** DRS detection: within one second of the car ahead. Source: FIA Formula 1 Sporting Regulations. */
  drsRangeMs: 1000,
  /** Pace advantage an overtake needs. Source: real F1, 1–2 s (research 06 §5 item 6). */
  overtakeThresholdMs: 1000,
  /** Line crossings the closing rate (a Theil–Sen slope over the gaps at the line) is taken over, the newest last. Source: pitwall estimate. */
  closingWindow: 5,
  /** Fewer line crossings than this give no closing rate: two gap changes. Source: pitwall estimate. */
  closingMinSamples: 3,
});
