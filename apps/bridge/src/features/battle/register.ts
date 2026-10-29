import { BATTLE_CONFIG, battleCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `battle`: our cars against the car ahead and the car behind (`battle.cards`). */
export default defineFeature({
  name: 'battle',
  calculators: [battleCalculator],
  topics: [bindState('battle.cards', battleCalculator, selectCar)],
  config: [BATTLE_CONFIG],
});
