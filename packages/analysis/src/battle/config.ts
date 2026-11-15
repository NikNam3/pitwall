// Defaults of `battle` (spec Appendix B). The DRS range is `race-interaction`'s `drsRangeMs`, the one DRS rule (C43).
import { defineConfig } from '@pitwall/engine/readers';

export const BATTLE_CONFIG = defineConfig('battle', {
  /** Fewer usable mini-sectors than this in the PACE Δ window give no pace delta (`insufficientData`): half a lap. Source: pitwall estimate. */
  minPaceSegments: 25,
});
