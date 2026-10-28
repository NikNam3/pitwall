import { bindHistory, defineFeature } from '../feature.ts';

export default defineFeature({
  name: 'history',
  calculators: [],
  topics: (['laps', 'stints', 'pitStops', 'flagPhases', 'events'] as const).map((key) => bindHistory(key, key)),
});
