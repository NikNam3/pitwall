// Defaults of `tyre-wear` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const TYRE_WEAR_CONFIG = defineConfig('tyre-wear', {
  /** Wear limit in %: grip falls off fast at 65–75 % in F1 25. Source: https://racinggames.gg/article/f1-25-how-to-manage-pit-stops-fuel-and-tyres */
  limitPct: 70,
});
