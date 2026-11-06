// The priors entries of `tyre-life` (spec 3.2, 4.2): per compound and corner the wear per lap; and the set's limits,
// override-only (the config's value unless the set overrides it).
import type { Corners, VisualCompound } from '@pitwall/domain';
import { definePriors, type PriorDecl } from '@pitwall/engine/readers';

const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];
const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const satisfies ReadonlyArray<keyof Corners<unknown>>;

const notImplemented = (): never => {
  throw new Error('not implemented');
};

/** Wear per lap in %; `residual`: the source's value minus the set's. */
const wearRate: PriorDecl = { version: 1, range: [0, 20], aggregate: notImplemented, residual: notImplemented };

export const TYRE_LIFE_PRIORS = definePriors('tyre-life', {
  entries: {
    ...Object.fromEntries(COMPOUNDS.flatMap((compound) => CORNERS.map((corner) => [`tyreLife.wearPerLapPct.${compound}.${corner}`, wearRate]))),
    /** Override-only: the wear limit in %. */
    'tyreLife.wearLimitPct': { version: 1, range: [30, 100] },
    /** Override-only: the age basis's loss limit in ms. */
    'tyreLife.ageLossLimitMs': { version: 1, range: [200, 10000] },
  },
});
