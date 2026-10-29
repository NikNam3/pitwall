import { CAR_BANDS_CONFIG, carBandsCalculator } from '@pitwall/analysis';
import type { CarId } from '@pitwall/domain';
import { bindState, defineFeature } from '../feature.ts';

/** `carBands.car`: the output is keyed by car id; `params.carId` must name a car in it. */
export default defineFeature({
  name: 'car-bands',
  calculators: [carBandsCalculator],
  topics: [
    bindState('carBands.car', carBandsCalculator, (out, params) => {
      if (!Object.hasOwn(params, 'carId')) return undefined;
      const { carId } = params as { carId: unknown };
      return typeof carId === 'number' && Number.isInteger(carId) && Object.hasOwn(out, carId) ? out[carId as CarId] : undefined;
    }),
  ],
  config: [CAR_BANDS_CONFIG],
});
