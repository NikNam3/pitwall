import { WEEKEND_PACE_CONFIG, weekendPaceCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `weekend-pace` (SP4.3d2 Task 6b): each car's race pace before its first race lap, from the weekend's practice and
 * qualifying; a calculator other units read (no topic, C42), with its config (C47).
 */
export default defineFeature({
  name: 'weekend-pace',
  calculators: [weekendPaceCalculator],
  config: [WEEKEND_PACE_CONFIG],
  topics: [],
});
