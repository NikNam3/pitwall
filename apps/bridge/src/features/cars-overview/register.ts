import type { CarOverview } from '@pitwall/contracts';
import { copyPlain, type QuickCalculator } from '@pitwall/engine/readers';
import { bindState, defineFeature } from '../feature.ts';

/**
 * Every car's identity, timing (without its confirmed laps) and tyres, as the live state holds them (C54); a car's stop
 * count is `pit-stop-count`'s (`pitStopCount.byCar`). The compound is the live one only: the stint records hold closed
 * stints, so the latest is the previous set.
 */
const carsOverview: QuickCalculator<CarOverview[]> = {
  id: 'cars.overview',
  kind: 'quick',
  // `updatedAt` moves with every source, so it reads every area a source feeds.
  reads: ['identity', 'timing', 'tyres', 'condition', 'dynamics', 'ownCar', 'laps', 'stints'],
  cadence: { hz: 10 },
  compute: ({ live }) =>
    live.cars.map(({ id, identity, timing: { confirmedLaps: _confirmedLaps, ...timing }, tyres, updatedAt }) => {
      return copyPlain({
        id,
        identity,
        timing,
        tyres: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
        updatedAt,
      }) as CarOverview;
    }),
};

export default defineFeature({
  name: 'cars-overview',
  calculators: [carsOverview],
  topics: [bindState('cars.overview', carsOverview)],
});
