import { tyreLifeCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `tyre-life` (spec 4.2; SP4.3c Task 12): per car its set's wear, rate and laps to the limit per corner, from
 * `tyre-model`; a calculator other units read (no topic). It declares no config and no priors (the limit is
 * `tyre-model.limitPct`, C43).
 */
export default defineFeature({
  name: 'tyre-life',
  calculators: [tyreLifeCalculator],
  topics: [],
});
