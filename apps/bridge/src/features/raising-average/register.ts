import { raisingAverageCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `raising-average` (SP4.1b spec 3): `raisingAverage.field`. */
export default defineFeature({
  name: 'raising-average',
  calculators: [raisingAverageCalculator],
  topics: [bindState('raisingAverage.field', raisingAverageCalculator)],
});
