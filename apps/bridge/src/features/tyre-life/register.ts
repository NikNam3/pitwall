import { TYRE_LIFE_CONFIG, TYRE_LIFE_PRIORS, tyreLifeCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `tyre-life` (spec 4.2): the laps until each car's set reaches its limit and the fresh-set life per compound, a
 * calculator other units read (no topic), and the calibration priors (`tyreLife.*`, C62a) the priors store runs over
 * calibration sets.
 */
export default defineFeature({
  name: 'tyre-life',
  calculators: [tyreLifeCalculator],
  topics: [],
  config: [TYRE_LIFE_CONFIG],
  priors: [TYRE_LIFE_PRIORS],
});
