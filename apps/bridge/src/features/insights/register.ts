import { defineFeature } from '../feature.ts';

export default defineFeature({
  name: 'insights',
  calculators: [],
  topics: [{ topic: 'insights', fromInsights: true }],
});
