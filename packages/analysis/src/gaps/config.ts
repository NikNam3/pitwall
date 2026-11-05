// Defaults of `gaps` (spec Appendix B).
import { defineConfig } from '@pitwall/engine/readers';

export const GAPS_CONFIG = defineConfig('gaps', {
  /** A car this close to one of ours, ahead or behind, is in its neighbourhood. Source: research 06 §4. */
  neighbourhoodMs: 3000,
  /** The gapper's newest laps drawn with one point per mini-sector crossing; older laps get one point per lap. Source: pitwall estimate. */
  fineLaps: 10,
  /** A car this close to one of ours on the gapper, ahead or behind, enters the gapper's window. Source: pitwall estimate. */
  windowMs: 10_000,
  /** A car in the gapper's window leaves it only beyond `windowMs` plus this, so a car at the edge does not flicker. Source: pitwall estimate. */
  windowExitMs: 1_000,
});
