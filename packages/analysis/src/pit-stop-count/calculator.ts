import type { CarId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { carsOfSession } from './cars.ts';
import { PIT_STOP_COUNT, type PitStopCounts } from './index.ts';

/** Each car's pit stops: the number of its pit-stop records in the projection, for every car of the session (C42). */
export const pitStopCountCalculator: QuickCalculator<PitStopCounts> = {
  id: PIT_STOP_COUNT,
  kind: 'quick',
  reads: ['pitStops', CAR_STATUS_READS],
  cadence: { hz: 10 },
  compute: (view): PitStopCounts => {
    const stops = new Map<CarId, number>();
    for (const record of view.history.pitStops) stops.set(record.carId, (stops.get(record.carId) ?? 0) + 1);
    return { byCar: carsOfSession(view).map((carId) => ({ carId, stops: stops.get(carId) ?? 0 })) };
  },
};
