import type { CarOverview } from '@pitwall/contracts';
import type { QuickCalculator } from '@pitwall/engine';
import { bindState, defineFeature } from '../feature.ts';

const carsOverview: QuickCalculator<CarOverview[]> = {
  id: 'cars.overview',
  kind: 'quick',
  reads: ['identity', 'timing', 'tyres', 'stints'],
  cadence: { hz: 10 },
  compute: ({ state }) =>
    state.cars.map(({ id, identity, timing, tyres }) =>
      structuredClone({
        id,
        identity,
        timing,
        tyres: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
      }),
    ),
};

export default defineFeature({
  name: 'cars-overview',
  calculators: [carsOverview],
  topics: [bindState('cars.overview', carsOverview)],
});
