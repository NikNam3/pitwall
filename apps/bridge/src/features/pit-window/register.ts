import { PIT_WINDOW_CONFIG, pitWindowCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `pit-window` (SP4.2 spec 3.4): `pitWindow.car`. */
export default defineFeature({
  name: 'pit-window',
  calculators: [pitWindowCalculator],
  topics: [bindState('pitWindow.car', pitWindowCalculator, selectCar)],
  config: [PIT_WINDOW_CONFIG],
});
