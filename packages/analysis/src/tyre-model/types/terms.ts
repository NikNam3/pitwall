// What the three tyre-type modules share: the heat term on a chosen rate (research 20 §6: % per lap per °C of carcass
// above the temperature the rate assumes) and a term with its value and source.
import { known, type Known, type Ms, type TyreSource, type TyreTerm } from '@pitwall/domain';
import type { TypeRateInput } from './module.ts';

/** A term of `value` known at `at`, from `source`. */
export const termOf = <T>(value: Known<T>, source: TyreSource): TyreTerm<T> => ({ value, source });

/**
 * The base rate plus `heatPctPerLapPerC` per °C of carcass above the temperature it assumes, never below 0; the base as
 * it is without a carcass reading (an AI car) or a known base. `scale` multiplies the base first (the inter's drying).
 */
export function withHeat(input: TypeRateInput, heatPctPerLapPerC: number, scale = 1): TyreTerm<number> {
  const { base, carcassC } = input;
  if (!base.value.known) return base;
  const heat = carcassC === undefined ? 0 : heatPctPerLapPerC * (carcassC.now - carcassC.basis);
  return termOf(known(Math.max(0, base.value.value * scale + heat), base.value.at), base.source);
}

/** A loss per % of wear: the game's where measured, else the type's default (C3: a default with its source, never 0). */
export const lossTerm = (gameMsPerPct: number | undefined, defaultMsPerPct: number): TyreTerm<number> =>
  gameMsPerPct === undefined ? termOf(known(defaultMsPerPct, 0), 'default') : termOf(known(gameMsPerPct, 0), 'game');

/** A fixed offset of the type's config, in whole ms (C4). */
export const configOffset = (ms: number): TyreTerm<Ms> => termOf(known(Math.round(ms), 0), 'default');
