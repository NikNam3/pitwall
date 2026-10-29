import { ALARMS_CONFIG, alarmsCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/** `alarms`: insights for our cars; they reach the `insights` topic, so no topic of its own. */
export default defineFeature({
  name: 'alarms',
  calculators: [alarmsCalculator],
  topics: [],
  config: [ALARMS_CONFIG],
});
