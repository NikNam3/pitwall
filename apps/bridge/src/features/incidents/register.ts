import { INCIDENTS_CONFIG, incidentsCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `incidents`: the feed of incidents to our cars and their neighbourhood (`incidents.feed`) and the major ones on the track map (`incidents.markers`). */
export default defineFeature({
  name: 'incidents',
  calculators: [incidentsCalculator],
  topics: [
    bindState('incidents.feed', incidentsCalculator, (out) => out.feed),
    bindState('incidents.markers', incidentsCalculator, (out) => out.markers),
  ],
  config: [INCIDENTS_CONFIG],
});
