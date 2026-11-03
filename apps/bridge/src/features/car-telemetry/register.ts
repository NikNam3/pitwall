import type { TopicValue } from '@pitwall/contracts';
import { copyPlain, type QuickCalculator } from '@pitwall/engine/readers';
import { bindState, defineFeature } from '../feature.ts';
import { selectCarSlot, type ViewCars } from '../car-params.ts';

/** Every car, copied: an output never changes once returned, and the engine changes its cars in place. */
const carsDynamics: QuickCalculator<ViewCars> = {
  id: 'cars.dynamics',
  kind: 'quick',
  reads: ['dynamics'],
  cadence: 'frame',
  compute: ({ state }) => copyPlain(state.cars),
};

export default defineFeature({
  name: 'car-telemetry',
  calculators: [carsDynamics],
  topics: [bindState('car.telemetry', carsDynamics, selectCarSlot<TopicValue<'car.telemetry'>>((car) => ({ motion: car.motion, dynamics: car.dynamics })))],
});
