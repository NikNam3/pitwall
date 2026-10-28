import type { CarOverview } from '@pitwall/contracts';
import type { QuickCalculator } from '@pitwall/engine';
import { defineFeature } from '../feature.ts';

const carsOverview: QuickCalculator<CarOverview[]> = {
  id: 'cars.overview',
  kind: 'quick',
  // `updatedAt` moves with every source, so it reads every area a source feeds.
  reads: ['identity', 'timing', 'tyres', 'condition', 'dynamics', 'ownCar', 'laps', 'stints'],
  cadence: { hz: 10 },
  compute: ({ state }) =>
    state.cars.map(({ id, identity, timing, tyres, updatedAt }) =>
      structuredClone({
        id,
        identity,
        timing,
        tyres: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
        updatedAt,
      }),
    ),
};

export default defineFeature({
  name: 'cars-overview',
  calculators: [carsOverview],
  topics: [{ topic: 'cars.overview', from: 'cars.overview' }],
});
