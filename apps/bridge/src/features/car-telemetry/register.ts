import type { QuickCalculator } from '@pitwall/engine';
import { defineFeature } from '../feature.ts';
import { selectCar, type ViewCars } from '../car-params.ts';

/** Every car, by reference; the topic's `select` clones the dynamics of the one car a subscription asks for. */
const carsDynamics: QuickCalculator<ViewCars> = {
  id: 'cars.dynamics',
  kind: 'quick',
  reads: ['motion', 'telemetry'],
  cadence: 'frame',
  compute: ({ state }) => state.cars,
};

export default defineFeature({
  name: 'car-telemetry',
  calculators: [carsDynamics],
  topics: [{ topic: 'car.telemetry', from: 'cars.dynamics', select: selectCar((car) => car.dynamics) }],
});
