import type { CarOverview } from '@pitwall/contracts';
import { copyPlain } from '@pitwall/engine/readers';
import { bindLive, defineFeature, type LiveView } from '../feature.ts';

/**
 * Every car's identity, timing (without its confirmed laps) and tyres, as the live state holds them: a core topic (C54,
 * C55), no calculator, copied when the hub sends it. A car's stop count is `pit-stop-count`'s (`pitStopCount.byCar`).
 */
const selectCarsOverview = (live: LiveView): CarOverview[] =>
  live.cars.map(({ id, identity, timing: { confirmedLaps: _confirmedLaps, ...timing }, tyres, updatedAt }) => {
    return copyPlain({
      id,
      identity,
      timing,
      tyres: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
      updatedAt,
    }) as CarOverview;
  });

export default defineFeature({
  name: 'cars-overview',
  calculators: [],
  topics: [bindLive('cars.overview', selectCarsOverview)],
});
