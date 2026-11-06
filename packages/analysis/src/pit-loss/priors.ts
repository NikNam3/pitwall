// The priors entries of `pit-loss` (spec 3.2, 4.3): per condition the median loss over every stop of the sessions that
// give the set a source, each session counted once; an override replaces it.
import type { PitCondition } from '@pitwall/domain';
import { definePriors, type PriorDecl } from '@pitwall/engine/readers';

const CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

const notImplemented = (): never => {
  throw new Error('not implemented');
};

/** `residual`: the source session's median minus the set's, in ms. */
const loss: PriorDecl = { version: 1, range: [5000, 60000], aggregate: notImplemented, residual: notImplemented };

export const PIT_LOSS_PRIORS = definePriors('pit-loss', {
  entries: Object.fromEntries(CONDITIONS.map((condition) => [`pitLoss.ms.${condition}`, loss])),
});
