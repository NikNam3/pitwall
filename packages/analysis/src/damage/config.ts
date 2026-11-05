// Defaults of `damage` (spec Appendix B).
import { defineConfig } from '@pitwall/engine/readers';

export const DAMAGE_CONFIG = defineConfig('damage', {
  /** Rises within the window that add up to at least this are a jump, in %. Source: pitwall estimate. */
  jumpPct: 5,
  /** Window that rises of one jump fall into. Source: pitwall estimate. */
  jumpWindowMs: 2000,
  /** Mini-sectors since a jump needed before its loss is estimated from them. Source: pitwall estimate. */
  minEstimateSegments: 10,
});
