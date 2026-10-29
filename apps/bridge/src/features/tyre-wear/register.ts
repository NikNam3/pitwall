import { TYRE_WEAR_CONFIG, tyreWearCalculator, type TyreWearOutput } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `params.carId` must be an own integer property naming a car in the output. */
const selectCar = (out: TyreWearOutput, params: object) => {
  if (!Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && Object.hasOwn(out, carId) ? out[carId as keyof TyreWearOutput] : undefined;
};

/** `tyre-wear`: wear, rate and laps to the limit per corner (`tyreWear.car`). */
export default defineFeature({
  name: 'tyre-wear',
  calculators: [tyreWearCalculator],
  topics: [bindState('tyreWear.car', tyreWearCalculator, selectCar)],
  config: [TYRE_WEAR_CONFIG],
});
