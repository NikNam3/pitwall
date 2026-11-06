// The priors entries of `degradation` (spec 3.2, 4.1, C62a): per compound the filter's `α` offset, `ν` and its sd, run
// over each source stint from the config default and pooled by inverse variance; an override replaces the pooled value.
import { known, unknown, type Known, type LapUse, type VisualCompound } from '@pitwall/domain';
import { definePriors, type PriorDecl, type PriorsCtx, type StoredSource } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { DEGRADATION_CONFIG } from './config.ts';
import { fitStint, type StintFitResult } from './kalman.ts';
import { fitLaps, fuelResolver, lapClassOf, lapsByCar, type FittedStint } from './stint-fit.ts';

/** The compounds a set holds priors for. */
export const DEGRADATION_COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];

/** The compound the `α` offsets are relative to (as the track file's `compoundOffsetsMs`: medium = 0). */
const REFERENCE: VisualCompound = 'medium';

/** The key of entry `name` for `compound`: `degradation.<name>.<compound>`. */
export const priorKey = (name: 'alphaOffsetMs' | 'nuMsPerLap' | 'nuSdMs', compound: VisualCompound): string => `degradation.${name}.${compound}`;

/** A config section's effective values in a priors context (C47): the defaults under `ctx.config`'s overrides. */
const configOf = <C extends object>(section: { key: string; defaults: C }, ctx: PriorsCtx): C => ({ ...section.defaults, ...ctx.config[section.key] }) as C;

/** A source's stint through the calculator's rules, from the config default (the set's own values never feed back). */
function sourceFit(source: StoredSource, ctx: PriorsCtx): FittedStint {
  const config = configOf(DEGRADATION_CONFIG, ctx);
  const isRace = source.phase.kind === 'race';
  const classes = { isRace, ...configOf(LAP_CLASSES_CONFIG, ctx) };
  const rate = configOf(PER_LAP_RATE_CONFIG, ctx);
  const fuelOf = fuelResolver({
    isRace,
    ourLaps: () => lapsByCar(source.sessionLaps).get(source.source.feedCar) ?? [],
    classes,
    rate,
    fallbackBurnKgPerLap: config.fallbackBurnKgPerLap,
  });
  return fitLaps(source.laps, fuelOf, { nuMsPerLap: config.defaultNuMsPerLap, nuSdMs: config.defaultNuSdMs }, config, classes, rate);
}

/** The fits (`fitStint`, at least two pace laps) of the sources on `compound`. */
function fitsOf(sources: readonly StoredSource[], compound: VisualCompound, ctx: PriorsCtx): StintFitResult[] {
  const config = configOf(DEGRADATION_CONFIG, ctx);
  const prior = { nuMsPerLap: config.defaultNuMsPerLap, nuSdMs: config.defaultNuSdMs };
  return sources.flatMap((s) => {
    if (s.stint.visualCompound !== compound) return [];
    const fit = fitStint(sourceFit(s, ctx).paceLaps, prior, config);
    return fit.known ? [fit.value] : [];
  });
}

/**
 * Inverse-variance pooling with the between-source spread (DerSimonian–Laird): the pooled mean, and the sd a new stint's
 * value has around it (the pooled mean's variance plus the spread).
 */
function pool(items: readonly { mean: number; variance: number }[]): { mean: number; sd: number } | undefined {
  if (items.length === 0) return undefined;
  const weighted = items.map((i) => ({ mean: i.mean, w: 1 / Math.max(i.variance, 1e-9) }));
  const sw = weighted.reduce((a, it) => a + it.w, 0);
  const fixed = weighted.reduce((a, it) => a + it.w * it.mean, 0) / sw;
  const q = weighted.reduce((a, it) => a + it.w * (it.mean - fixed) ** 2, 0);
  const c = sw - weighted.reduce((a, it) => a + it.w * it.w, 0) / sw;
  const tau2 = items.length > 1 && c > 0 ? Math.max(0, (q - (items.length - 1)) / c) : 0;
  const random = items.map((i) => ({ mean: i.mean, w: 1 / (Math.max(i.variance, 1e-9) + tau2) }));
  const swr = random.reduce((a, it) => a + it.w, 0);
  const mean = random.reduce((a, it) => a + it.w * it.mean, 0) / swr;
  return { mean, sd: Math.sqrt(1 / swr + tau2) };
}

/** An override of `key` replaces the aggregate (spec 3.2). */
const overridden = (key: string, ctx: PriorsCtx, aggregate: () => Known<number>): Known<number> => {
  const o = ctx.overrides[key];
  return o === undefined ? aggregate() : known(o, 0);
};

const nuPool = (sources: readonly StoredSource[], compound: VisualCompound, ctx: PriorsCtx) =>
  pool(fitsOf(sources, compound, ctx).map((f) => ({ mean: f.nuMsPerLap, variance: f.cov[1][1] })));

const alphaPool = (sources: readonly StoredSource[], compound: VisualCompound, ctx: PriorsCtx) =>
  pool(fitsOf(sources, compound, ctx).map((f) => ({ mean: f.alphaMs, variance: f.cov[0][0] })));

/** `ν` of `compound`, ms per lap. `residual`: the source's `ν` minus the set's, in the set's sd. */
const nuEntry = (compound: VisualCompound): PriorDecl => ({
  version: 1,
  range: [0, 1000],
  aggregate: (sources, ctx) => {
    const key = priorKey('nuMsPerLap', compound);
    return overridden(key, ctx, () => {
      const p = nuPool(sources, compound, ctx);
      return p === undefined ? unknown('insufficientData') : known(p.mean, 0);
    });
  },
  residual: (source, set) => {
    const own = source[priorKey('nuMsPerLap', compound)];
    const value = set[priorKey('nuMsPerLap', compound)];
    const sd = set[priorKey('nuSdMs', compound)];
    if (own === undefined || value === undefined || sd === undefined || !own.known || !value.known || !sd.known || sd.value <= 0) return unknown('insufficientData');
    return known((own.value - value.value) / sd.value, 0);
  },
});

/** The sd of `ν` of `compound` a new stint starts from, ms per lap (at least 1, the entry's range). */
const nuSdEntry = (compound: VisualCompound): PriorDecl => ({
  version: 1,
  range: [1, 1000],
  aggregate: (sources, ctx) =>
    overridden(priorKey('nuSdMs', compound), ctx, () => {
      const p = nuPool(sources, compound, ctx);
      return p === undefined ? unknown('insufficientData') : known(Math.max(1, p.sd), 0);
    }),
});

/** The tyre-pace offset `α` of `compound` against medium's, in ms (medium is 0). */
const alphaEntry = (compound: VisualCompound): PriorDecl => ({
  version: 1,
  range: [-5000, 5000],
  aggregate: (sources, ctx) =>
    overridden(priorKey('alphaOffsetMs', compound), ctx, () => {
      const reference = alphaPool(sources, REFERENCE, ctx);
      if (reference === undefined) return unknown('insufficientData');
      if (compound === REFERENCE) return known(0, 0);
      const own = alphaPool(sources, compound, ctx);
      return own === undefined ? unknown('insufficientData') : known(Math.round(own.mean - reference.mean), 0);
    }),
});

export const DEGRADATION_PRIORS = definePriors('degradation', {
  entries: Object.fromEntries(
    DEGRADATION_COMPOUNDS.flatMap((compound) => [
      [priorKey('alphaOffsetMs', compound), alphaEntry(compound)],
      [priorKey('nuMsPerLap', compound), nuEntry(compound)],
      [priorKey('nuSdMs', compound), nuSdEntry(compound)],
    ]),
  ),
  /** A stint of at least `minSourceLaps` `forPace` laps. */
  candidate: (source, ctx) => {
    const classes = { isRace: source.phase.kind === 'race', ...configOf(LAP_CLASSES_CONFIG, ctx) };
    const pace = source.laps.filter((l) => lapClassOf(l, classes) === 'pace').length;
    return pace >= configOf(DEGRADATION_CONFIG, ctx).minSourceLaps;
  },
  /** Per lap of the source how the filter uses it, as the calculator does. */
  lapUse: (source, ctx): Record<number, LapUse> => Object.fromEntries(sourceFit(source, ctx).laps.map((l) => [l.lapNumber, l.use])),
});
