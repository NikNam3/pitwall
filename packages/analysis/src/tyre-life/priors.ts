// The priors entries of `tyre-life` (spec 3.2, 4.2): per compound and corner the wear per lap, each source's stint
// through the calculator's rate rule and pooled by the median of the sources' rates; and the set's limits,
// override-only (the config's value unless the set overrides it).
import { known, unknown, type Known, type VisualCompound } from '@pitwall/domain';
import { definePriors, type PriorDecl, type PriorsCtx, type StoredSource } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { CORNERS, cornerRate, rateLaps, type Corner } from './wear-rate.ts';

const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];

/** The key of the wear per lap of `compound` at `corner`: `tyreLife.wearPerLapPct.<compound>.<corner>`. */
export const wearRateKey = (compound: VisualCompound, corner: Corner): string => `tyreLife.wearPerLapPct.${compound}.${corner}`;

/** The override-only key of the wear limit in %. */
export const WEAR_LIMIT_KEY = 'tyreLife.wearLimitPct';

/** The override-only key of the age basis's loss limit in ms. */
export const AGE_LOSS_LIMIT_KEY = 'tyreLife.ageLossLimitMs';

/** A config section's effective values in a priors context (C47): the defaults under `ctx.config`'s overrides. */
const configOf = <C extends object>(section: { key: string; defaults: C }, ctx: PriorsCtx): C => ({ ...section.defaults, ...ctx.config[section.key] }) as C;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

/** Wear per lap in % of `compound` at `corner`; `residual`: the source's value minus the set's. */
const wearRate = (compound: VisualCompound, corner: Corner): PriorDecl => {
  const key = wearRateKey(compound, corner);
  return {
    version: 1,
    range: [0, 20],
    aggregate: (sources: readonly StoredSource[], ctx: PriorsCtx): Known<number> => {
      const override = ctx.overrides[key];
      if (override !== undefined) return known(override, 0);
      const classes = configOf(LAP_CLASSES_CONFIG, ctx);
      const opts = configOf(PER_LAP_RATE_CONFIG, ctx);
      const rates: number[] = [];
      for (const source of sources) {
        if (source.stint.visualCompound !== compound) continue;
        const rate = cornerRate(rateLaps(source.laps, classes), corner, opts);
        if (rate.known) rates.push(rate.value.perLap);
      }
      return rates.length === 0 ? unknown('insufficientData') : known(median(rates), 0);
    },
    residual: (source, set): Known<number> => {
      const own = source[key];
      const pooled = set[key];
      if (own?.known !== true || pooled?.known !== true) return unknown('insufficientData');
      return known(own.value - pooled.value, Math.max(own.at, pooled.at));
    },
  };
};

export const TYRE_LIFE_PRIORS = definePriors('tyre-life', {
  entries: {
    ...Object.fromEntries(COMPOUNDS.flatMap((compound) => CORNERS.map((corner) => [wearRateKey(compound, corner), wearRate(compound, corner)]))),
    /** Override-only: the wear limit in %. */
    [WEAR_LIMIT_KEY]: { version: 1, range: [30, 100] },
    /** Override-only: the age basis's loss limit in ms. */
    [AGE_LOSS_LIMIT_KEY]: { version: 1, range: [200, 10000] },
  },
});
