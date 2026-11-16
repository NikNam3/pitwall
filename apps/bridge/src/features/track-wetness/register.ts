import { TRACK_WETNESS_CONFIG, TRACK_WETNESS_PRIORS, trackWetnessCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `track-wetness` (SP4.3a spec 5.1; SP4.3c O3): per lap and tyre type the field's common mode, the filtered wetness
 * state, the one wet rule and the dry reference, a calculator `driver-noise`, `crossover` and the forecast read (no
 * topic). Its priors entry (`trackWetness.dryRefMs`) runs in the bridge's priors store (C62a).
 */
export default defineFeature({
  name: 'track-wetness',
  calculators: [trackWetnessCalculator],
  topics: [],
  config: [TRACK_WETNESS_CONFIG],
  priors: [TRACK_WETNESS_PRIORS],
});
