import { fuelCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `fuel`: fuel, burn and margin per car in the session (`fuel.car`). */
export default defineFeature({
  name: 'fuel',
  calculators: [fuelCalculator],
  topics: [bindState('fuel.car', fuelCalculator, selectCar)],
});
