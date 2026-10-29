import { DAMAGE_CONFIG, damageCalculator, type DamageOutput } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `params.carId` must be an own integer property naming a car in the output. */
const selectCar = (out: DamageOutput, params: object) => {
  if (!Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && Object.hasOwn(out, carId) ? out[carId as keyof DamageOutput] : undefined;
};

/** `damage`: damage per part and corner, faults and jumps (`damage.car`). */
export default defineFeature({
  name: 'damage',
  calculators: [damageCalculator],
  topics: [bindState('damage.car', damageCalculator, selectCar)],
  config: [DAMAGE_CONFIG],
});
