// Defaults of `tyre-life` (spec 4.2, 7); a calibration set may override both (`tyreLife.wearLimitPct`, `tyreLife.ageLossLimitMs`).
import { defineConfig } from '@pitwall/engine/readers';

export const TYRE_LIFE_CONFIG = defineConfig('tyre-life', {
  /** Wear limit in %: grip falls off fast at 65–75 % in F1 25. Source: `tyre-wear`'s, https://racinggames.gg/article/f1-25-how-to-manage-pit-stops-fuel-and-tyres */
  wearLimitPct: 70,
  /** Age basis: the set is at its limit once `ν · age` reaches this, in ms. Source: pitwall estimate. */
  ageLossLimitMs: 2000,
});
