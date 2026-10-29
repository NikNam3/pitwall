import { fuelCalculator, type FuelOutput } from '@pitwall/analysis';
import type { CarId } from '@pitwall/domain';
import { bindState, defineFeature } from '../feature.ts';

/** The fuel state of the car `params.carId` names; `undefined` for anything that is not an active car of the output. */
const selectFuel = (out: FuelOutput, params: object) => {
  if (!Object.hasOwn(params, 'carId')) return undefined;
  const id = (params as { carId: unknown }).carId;
  if (typeof id !== 'number' || !Number.isInteger(id)) return undefined;
  const state = out[id as CarId];
  return state === undefined ? undefined : structuredClone(state);
};

export default defineFeature({
  name: 'fuel',
  calculators: [fuelCalculator],
  topics: [bindState('fuel.car', fuelCalculator, selectFuel)],
});
