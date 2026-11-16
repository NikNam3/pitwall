import { circleCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `circle` (SP4.3d spec §6.5): `circle.car`, the field as a lap circle for one of our cars. */
export default defineFeature({
  name: 'circle',
  calculators: [circleCalculator],
  topics: [bindState('circle.car', circleCalculator, (out, params) => selectCar(out.cars, params))],
});
