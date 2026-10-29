// Defaults of `damage` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const DAMAGE_CONFIG = defineConfig('damage', {
  /** Rises within the window that add up to at least this are a jump, in %. Source: pitwall estimate. */
  jumpPct: 5,
  /** Window that rises of one jump fall into. Source: pitwall estimate. */
  jumpWindowMs: 2000,
});
