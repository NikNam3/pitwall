import { weatherCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `weather` (SP4.1b spec 3): `weather.forecast`. */
export default defineFeature({
  name: 'weather',
  calculators: [weatherCalculator],
  topics: [bindState('weather.forecast', weatherCalculator)],
});
