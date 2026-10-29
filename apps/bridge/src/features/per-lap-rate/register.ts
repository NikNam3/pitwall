import { PER_LAP_RATE_CONFIG } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `per-lap-rate` is a function that several analyses call (spec 4), so its config key needs one owner: this feature
 * only declares the key; the analyses read it with `PER_LAP_RATE_CONFIG.read(view)` and pass it as `opts`.
 */
export default defineFeature({
  name: 'per-lap-rate',
  calculators: [],
  topics: [],
  config: [PER_LAP_RATE_CONFIG],
});
