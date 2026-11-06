import { tyreWearCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `tyre-wear`: publishes `tyre-life`'s wear, rate and laps to the limit per corner (`tyreWear.car`, spec 4.2). */
export default defineFeature({
  name: 'tyre-wear',
  calculators: [tyreWearCalculator],
  topics: [bindState('tyreWear.car', tyreWearCalculator, selectCar)],
});
