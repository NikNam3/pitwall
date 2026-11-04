import { pitStopCountCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `pit-stop-count`: each car's pit stops from the projection's pit-stop records (`pitStopCount.byCar`, C54). */
export default defineFeature({
  name: 'pit-stop-count',
  calculators: [pitStopCountCalculator],
  topics: [bindState('pitStopCount.byCar', pitStopCountCalculator)],
});
