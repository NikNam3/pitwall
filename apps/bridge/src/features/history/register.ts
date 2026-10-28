import { bindHistory, defineFeature } from '../feature.ts';

export default defineFeature({
  name: 'history',
  calculators: [],
  // One call per pair, so each topic is checked against its own history list.
  topics: [
    bindHistory('laps', 'laps'),
    bindHistory('stints', 'stints'),
    bindHistory('pitStops', 'pitStops'),
    bindHistory('flagPhases', 'flagPhases'),
    bindHistory('events', 'events'),
  ],
});
