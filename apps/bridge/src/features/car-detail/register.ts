import type { QuickCalculator } from '@pitwall/engine';
import { defineFeature } from '../feature.ts';
import { selectCar, type ViewCars } from '../car-params.ts';

/** Every car, by reference; the topic's `select` clones the one car a subscription asks for. */
const carsState: QuickCalculator<ViewCars> = {
  id: 'cars.state',
  kind: 'quick',
  reads: ['identity', 'timing', 'tyres', 'energy', 'condition', 'dynamics', 'ownCar', 'laps', 'stints'],
  cadence: 'frame',
  compute: ({ state }) => state.cars,
};

export default defineFeature({
  name: 'car-detail',
  calculators: [carsState],
  topics: [{ topic: 'car.detail', from: 'cars.state', select: selectCar((car) => car) }],
});
