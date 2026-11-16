// The wet module of `tyre-model` (SP4.3c spec §5.2): wear linear in age, no drying term and a heat term of 0 (neither
// measured yet); the game's loss per % (the inter's default until measured); the fresh-set offset the lap model's
// config holds.
import { defineConfig } from '@pitwall/engine/readers';
import { configOf } from '../../shared/config-of.ts';
import { FORECAST_FIELD_CONFIG } from '../../shared/forecast-field/config.ts';
import type { TypeModule } from './module.ts';
import { configOffset, lossTerm, withHeat } from './terms.ts';

export const WET_CONFIG = defineConfig('tyre-model.wet', {
  /** Wear per lap per °C of carcass above the temperature the rate assumes, % per lap. Source: not measured yet. */
  heatPctPerLapPerC: 0,
  /** The wet's lap-time loss per % of wear without the game's, ms. Source: research 22 §1.6 (the inter's until measured). */
  lossMsPerPct: 11,
});

export const wet: TypeModule = {
  wearRatePct: (input) => withHeat(input, configOf(WET_CONFIG, input).heatPctPerLapPerC),
  lossMsPerPct: (input) => lossTerm(input.gameMsPerPct, configOf(WET_CONFIG, input).lossMsPerPct),
  freshOffsetMs: (input) => configOffset(configOf(FORECAST_FIELD_CONFIG, input).wetOffsetMs),
};
