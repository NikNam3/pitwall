import { INCIDENTS_CONFIG, incidentsCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `incidents`: the feed of incidents to our cars and their neighbourhood (`incidents.feed`). */
export default defineFeature({
  name: 'incidents',
  calculators: [incidentsCalculator],
  topics: [bindState('incidents.feed', incidentsCalculator)],
  config: [INCIDENTS_CONFIG],
});
