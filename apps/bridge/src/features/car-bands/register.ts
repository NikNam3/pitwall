import { CAR_BANDS_CONFIG, carBandsCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `car-bands`: each car's channel bands (`carBands.car`). */
export default defineFeature({
  name: 'car-bands',
  calculators: [carBandsCalculator],
  topics: [bindState('carBands.car', carBandsCalculator, selectCar)],
  config: [CAR_BANDS_CONFIG],
});
