import { CROSSOVER_CONFIG, crossoverCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `crossover` (SP4.1b spec 3): `crossover.car`. */
export default defineFeature({
  name: 'crossover',
  calculators: [crossoverCalculator],
  topics: [bindState('crossover.car', crossoverCalculator, selectCar)],
  config: [CROSSOVER_CONFIG],
});
