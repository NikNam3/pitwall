import { RACE_HAZARD_CONFIG, raceHazardCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/** `race-hazard`: the SC and VSC chances per remaining lap (SP4.3b spec §5.2), a calculator the strategy units read; no topic. */
export default defineFeature({
  name: 'race-hazard',
  calculators: [raceHazardCalculator],
  topics: [],
  config: [RACE_HAZARD_CONFIG],
});
