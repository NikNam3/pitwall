import { RAIN_OUTLOOK_CONFIG, rainOutlookCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/** `rain-outlook` (spec 3.3): the rain judgement (C43), a calculator only; `weather` and `race-moment` read it. */
export default defineFeature({
  name: 'rain-outlook',
  calculators: [rainOutlookCalculator],
  topics: [],
  config: [RAIN_OUTLOOK_CONFIG],
});
