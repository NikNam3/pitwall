// The priors entries of `race-interaction` (C62a, SP4.3a spec 5.4): per configured difficulty band the pass curve's
// level and slope over the sources' stints' following episodes.
import { definePriors, type PriorDecl } from '@pitwall/engine/readers';

/** The priors key of band `band`'s pass-curve level. */
export const passLevelKey = (band: number): string => `raceInteraction.passLevel.b${band}`;
/** The priors key of band `band`'s pass-curve slope. */
export const passSlopeKey = (band: number): string => `raceInteraction.passSlope.b${band}`;

const stub: PriorDecl = {
  version: 1,
  range: [-1000, 1000],
  aggregate: () => {
    throw new Error('not implemented');
  },
};

export const RACE_INTERACTION_PRIORS = definePriors('race-interaction', {
  entries: { [passLevelKey(0)]: stub, [passSlopeKey(0)]: stub, [passLevelKey(1)]: stub, [passSlopeKey(1)]: stub },
  candidate: () => {
    throw new Error('not implemented');
  },
});
