// The priors entries of `degradation` (spec 3.2, 4.1): per compound the filter's `α` offset, `ν` and its sd, run over
// each source stint and pooled by inverse variance; an override replaces the pooled value.
import type { VisualCompound } from '@pitwall/domain';
import { definePriors, type PriorDecl } from '@pitwall/engine/readers';

/** The compounds a set holds priors for. */
const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];

const notImplemented = (): never => {
  throw new Error('not implemented');
};

/** A pooled entry: the filter over every source; `residual` is the source's value minus the set's, in sd of the set's value. */
const pooled = (range: PriorDecl['range']): PriorDecl => ({ version: 1, range, aggregate: notImplemented, residual: notImplemented });

export const DEGRADATION_PRIORS = definePriors('degradation', {
  entries: Object.fromEntries(
    COMPOUNDS.flatMap((compound) => [
      /** The compound's tyre-pace offset `α`, in ms. */
      [`degradation.alphaOffsetMs.${compound}`, pooled([-5000, 5000])],
      /** Degradation per lap `ν`, in ms per lap. */
      [`degradation.nuMsPerLap.${compound}`, pooled([0, 1000])],
      /** The sd of `ν`, in ms per lap. */
      [`degradation.nuSdMs.${compound}`, pooled([1, 1000])],
    ]),
  ),
  /** A stint of at least `minSourceLaps` `forPace` laps. */
  candidate: notImplemented,
  /** Per lap of the source how the filter uses it (`forPace` laps, down-weighted outliers). */
  lapUse: notImplemented,
});
