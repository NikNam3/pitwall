import { ersCalculator, ERS_CONFIG, type ErsOutput } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** The state of the car `params.carId` names; `undefined` for anything else. */
const selectCar = (out: ErsOutput, params: object) => {
  if (!Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Object.hasOwn(out, carId) ? out[carId as keyof ErsOutput] : undefined;
};

export default defineFeature({
  name: 'ers',
  calculators: [ersCalculator],
  topics: [bindState('ers.car', ersCalculator, selectCar)],
  config: [ERS_CONFIG],
});
