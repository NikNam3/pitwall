import { scCallCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `sc-call` (SP4.2 spec 3.3): `scCall.car`. */
export default defineFeature({
  name: 'sc-call',
  calculators: [scCallCalculator],
  topics: [bindState('scCall.car', scCallCalculator, selectCar)],
});
