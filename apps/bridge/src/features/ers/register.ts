import { ersCalculator, ERS_CONFIG } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `ers`: the store, deploy and harvest per car (`ers.car`). */
export default defineFeature({
  name: 'ers',
  calculators: [ersCalculator],
  topics: [bindState('ers.car', ersCalculator, selectCar)],
  config: [ERS_CONFIG],
});
