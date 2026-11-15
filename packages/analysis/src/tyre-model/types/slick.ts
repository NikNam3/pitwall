// The slick module of `tyre-model` (SP4.3c spec §5.2): wear linear in age, a heat term (0 until measured), the game's
// loss per % per actual compound (the lap model's convex term above 40 % is configured here, flagged), the fresh-set
// offset from the game's sets with the track file as fallback.
import { unknown, type ActualCompound, type Ms, type TyreTerm } from '@pitwall/domain';
import { defineConfig } from '@pitwall/engine/readers';
import { configOf } from '../../shared/config-of.ts';
import type { TypeModule } from './module.ts';
import { lossTerm, termOf, withHeat } from './terms.ts';

export const SLICK_CONFIG = defineConfig('tyre-model.slick', {
  /** Wear per lap per °C of carcass above the temperature the rate assumes, % per lap. Source: not measured yet (research 20 §6). */
  heatPctPerLapPerC: 0,
  /** The lap model's convex tyre term starts at this wear, in %. Source: research 12 §4, 13 §1 (Fieni's shape, flagged); moved from forecast-field. */
  convexFromPct: 40,
  /** The convex tyre term per (% wear past `convexFromPct`)², in ms: about 4 s at 80 %. Source: pitwall estimate (flagged prior); research 19 §3. */
  convexMsPerPct2: 2.5,
  /** C1's lap-time loss per % of wear without the game's, ms. Source: research 22 §1.6. */
  lossC1MsPerPct: 22,
  /** C2's lap-time loss per % of wear without the game's, ms. Source: research 22 §1.6. */
  lossC2MsPerPct: 35,
  /** C3's lap-time loss per % of wear without the game's, ms. Source: research 22 §1.6. */
  lossC3MsPerPct: 57,
  /** C4's lap-time loss per % of wear without the game's, ms. Source: research 22 §1.6. */
  lossC4MsPerPct: 75,
  /** C5's lap-time loss per % of wear without the game's, ms. Source: not measured (research 22 §1.6 has none): C4's. */
  lossC5MsPerPct: 75,
});

type SlickConfig = (typeof SLICK_CONFIG)['defaults'];

/** The default loss per % of an actual compound; a compound the game names otherwise (an unknown one) takes C3's. */
function defaultLoss(actual: ActualCompound, c: SlickConfig): number {
  switch (actual) {
    case 'C1':
      return c.lossC1MsPerPct;
    case 'C2':
      return c.lossC2MsPerPct;
    case 'C4':
      return c.lossC4MsPerPct;
    case 'C5':
      return c.lossC5MsPerPct;
    default:
      return c.lossC3MsPerPct;
  }
}

export const slick: TypeModule = {
  wearRatePct: (input) => withHeat(input, configOf(SLICK_CONFIG, input).heatPctPerLapPerC),
  lossMsPerPct: (input) => lossTerm(input.gameMsPerPct, defaultLoss(input.actual, configOf(SLICK_CONFIG, input))),
  freshOffsetMs: (input): TyreTerm<Ms> => {
    if (input.gameMs !== undefined) return termOf({ known: true, value: Math.round(input.gameMs), at: 0 }, 'game');
    if (input.trackMs !== undefined) return termOf({ known: true, value: Math.round(input.trackMs), at: 0 }, 'default');
    return termOf(unknown('notReceived'), 'default');
  },
};
