import { DAMAGE_CONFIG, damageCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `damage`: damage per part and corner, faults and jumps (`damage.car`). */
export default defineFeature({
  name: 'damage',
  calculators: [damageCalculator],
  topics: [bindState('damage.car', damageCalculator, selectCar)],
  config: [DAMAGE_CONFIG],
});
