import { DEGRADATION_CONFIG, DEGRADATION_PRIORS, degradationCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `degradation` (spec 4.1): tyre pace and degradation per car and stint, a calculator other units read (no topic), and
 * the calibration priors per compound (`degradation.*`, C62a) the priors store runs over calibration sets.
 */
export default defineFeature({
  name: 'degradation',
  calculators: [degradationCalculator],
  topics: [],
  config: [DEGRADATION_CONFIG],
  priors: [DEGRADATION_PRIORS],
});
