// The domain helpers the engine calls per car, corner or segment on every frame, bound once. The domain index
// re-exports them with `export *`; under the test runner's module loader (vite) every read of such a re-export is a
// generic keyed lookup, which the per-frame loops would pay a few hundred times a frame. Reading them through this
// module costs that once. The same functions and values as `@pitwall/domain`'s.
import {
  actualCompoundFromCode as domainActualCompoundFromCode,
  cornersFromGameOrder as domainCornersFromGameOrder,
  known as domainKnown,
  OUT_OF_RACE_STATUSES as DOMAIN_OUT_OF_RACE_STATUSES,
  unknown as domainUnknown,
  visualCompoundFromCode as domainVisualCompoundFromCode,
} from '@pitwall/domain';

export const known = domainKnown;
export const unknown = domainUnknown;
export const cornersFromGameOrder = domainCornersFromGameOrder;
export const actualCompoundFromCode = domainActualCompoundFromCode;
export const visualCompoundFromCode = domainVisualCompoundFromCode;
export const OUT_OF_RACE_STATUSES = DOMAIN_OUT_OF_RACE_STATUSES;
