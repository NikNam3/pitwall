import { RIVAL_STOPS_CONFIG, rivalStopsCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/** `rival-stops` (SP4.3a spec 5.3): per rival the next stop's window, the next compound's odds, whether it owes a stop; a calculator (no topic). */
export default defineFeature({
  name: 'rival-stops',
  calculators: [rivalStopsCalculator],
  topics: [],
  config: [RIVAL_STOPS_CONFIG],
});
