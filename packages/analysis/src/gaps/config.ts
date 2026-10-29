// Defaults of `gaps` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const GAPS_CONFIG = defineConfig('gaps', {
  /** A car this close to one of ours, ahead or behind, is in its neighbourhood. Source: research 06 §4. */
  neighbourhoodMs: 3000,
});
