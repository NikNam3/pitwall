import { TRACK_WETNESS_CONFIG, trackWetnessCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `track-wetness` (SP4.3a spec 5.1): per lap and tyre type the field's common mode and the filtered wetness state, a
 * calculator `driver-noise` and the forecast read (no topic).
 */
export default defineFeature({
  name: 'track-wetness',
  calculators: [trackWetnessCalculator],
  topics: [],
  config: [TRACK_WETNESS_CONFIG],
});
