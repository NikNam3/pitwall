import { WEEKEND_PACE_CONFIG } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `weekend-pace` (SP4.3d2 Task 6b): each car's race pace before its first race lap, from the weekend's practice and
 * qualifying; a calculator other units read (no topic). Its config only until its task adds the calculator (C47, C81).
 */
export default defineFeature({
  name: 'weekend-pace',
  calculators: [],
  config: [WEEKEND_PACE_CONFIG],
  topics: [],
});
