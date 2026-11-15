import { INTER_CONFIG, SLICK_CONFIG, TYRE_MODEL_CONFIG, TYRE_MODEL_PROFILES, tyreModelCalculator, WET_CONFIG } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `tyre-model` (SP4.3c spec §5.2, O1): per car, compound and corner the tyre terms every planner and forecast reads, a
 * calculator other units read (no topic, C42); its config sections (the unit's and one per tyre type, C47) and its
 * driver-profile entries (`tyreModel.wearFactor.<compound>`, C62c) the bridge's profile store runs over each person's
 * linked sessions.
 */
export default defineFeature({
  name: 'tyre-model',
  calculators: [tyreModelCalculator],
  topics: [],
  config: [TYRE_MODEL_CONFIG, SLICK_CONFIG, INTER_CONFIG, WET_CONFIG],
  profiles: [TYRE_MODEL_PROFILES],
});
