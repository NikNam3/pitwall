// The inter module of `tyre-model` (SP4.3c spec §5.2): wear linear in age, raised as the track dries (research 21 §3)
// and by a carcass above the rate's (research 20 §6); the game's loss per %; the fresh-set offset the lap model's config
// holds (fitted with the wetness slopes, replaced only by a refit).
import { defineConfig } from '@pitwall/engine/readers';
import { configOf } from '../../shared/config-of.ts';
import { FORECAST_FIELD_CONFIG } from '../../shared/forecast-field/config.ts';
import type { TypeModule, TypeRateInput } from './module.ts';
import { configOffset, lossTerm, withHeat } from './terms.ts';

export const INTER_CONFIG = defineConfig('tyre-model.inter', {
  /** Wear per lap per °C of carcass above the temperature the rate assumes, % per lap. Source: research 20 §6. */
  heatPctPerLapPerC: 0.042,
  /** The rate grows by this share per s of track wetness lost since the measured window (a drying track). Source: research 21 §3. */
  dryingPerSecond: 0.06,
  /** The inter's lap-time loss per % of wear without the game's, ms. Source: research 22 §1.6. */
  lossMsPerPct: 11,
});

/** The drying factor: 1 plus `dryingPerSecond` per s of wetness lost (none on a steady or wetting track, or without a reading). */
function drying(input: TypeRateInput, perSecond: number): number {
  const w = input.wetnessMs;
  return w === undefined ? 1 : 1 + perSecond * Math.max(0, (w.window - w.now) / 1000);
}

export const inter: TypeModule = {
  wearRatePct: (input) => {
    const c = configOf(INTER_CONFIG, input);
    return withHeat(input, c.heatPctPerLapPerC, drying(input, c.dryingPerSecond));
  },
  lossMsPerPct: (input) => lossTerm(input.gameMsPerPct, configOf(INTER_CONFIG, input).lossMsPerPct),
  freshOffsetMs: (input) => configOffset(configOf(FORECAST_FIELD_CONFIG, input).interOffsetMs),
};
