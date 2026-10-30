import { LAP_CLASSES_CONFIG } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `lap-classes` is a function that several analyses call (spec 4), so its config key needs one owner: this feature
 * only declares the key; the analyses read it with `LAP_CLASSES_CONFIG.read(view)` and pass it to `classifyLap`.
 */
export default defineFeature({
  name: 'lap-classes',
  calculators: [],
  topics: [],
  config: [LAP_CLASSES_CONFIG],
});
