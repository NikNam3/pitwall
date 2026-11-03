import { bindLive, defineFeature } from '../feature.ts';
import { selectCarSlot } from '../car-params.ts';

/** One car's motion and dynamics from the live state, a core topic (C54, C55): no calculator, copied when the hub sends it. */
export default defineFeature({
  name: 'car-telemetry',
  calculators: [],
  topics: [bindLive('car.telemetry', selectCarSlot((car) => ({ motion: car.motion, dynamics: car.dynamics })))],
});
