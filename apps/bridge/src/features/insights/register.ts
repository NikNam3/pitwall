import { bindInsights, defineFeature } from '../feature.ts';

export default defineFeature({
  name: 'insights',
  calculators: [],
  topics: [bindInsights('insights')],
});
