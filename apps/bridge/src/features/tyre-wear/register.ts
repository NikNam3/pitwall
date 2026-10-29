import { TYRE_WEAR_CONFIG, tyreWearCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `tyre-wear`: wear, rate and laps to the limit per corner (`tyreWear.car`). */
export default defineFeature({
  name: 'tyre-wear',
  calculators: [tyreWearCalculator],
  topics: [bindState('tyreWear.car', tyreWearCalculator, selectCar)],
  config: [TYRE_WEAR_CONFIG],
});
