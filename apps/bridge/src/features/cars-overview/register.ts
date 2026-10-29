import type { CarOverview } from '@pitwall/contracts';
import type { CarId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { bindState, defineFeature } from '../feature.ts';

/** Every car's entries, by car id, of a history list (each car's latest last). */
function byCar<T extends { carId: CarId }>(records: readonly T[]): Map<CarId, T[]> {
  const out = new Map<CarId, T[]>();
  for (const r of records) {
    const list = out.get(r.carId);
    if (list === undefined) out.set(r.carId, [r]);
    else list.push(r);
  }
  return out;
}

/**
 * Every car's identity, timing and tyres, with the stop count reconciled: the game's count can lag a recorded stop.
 * The compound is the live one only: the stint records hold closed stints, so the latest is the previous set.
 */
const carsOverview: QuickCalculator<CarOverview[]> = {
  id: 'cars.overview',
  kind: 'quick',
  // `updatedAt` moves with every source, so it reads every area a source feeds.
  reads: ['identity', 'timing', 'tyres', 'condition', 'dynamics', 'ownCar', 'laps', 'stints', 'pitStops'],
  cadence: { hz: 10 },
  compute: ({ state }) => {
    const stops = byCar(state.history.pitStops);
    return state.cars.map(({ id, identity, timing, tyres, updatedAt }) => {
      return structuredClone({
        id,
        identity,
        timing,
        tyres: { actualCompound: tyres.actualCompound, visualCompound: tyres.visualCompound, age: tyres.age },
        stops: Math.max(stops.get(id)?.length ?? 0, timing.numPitStops),
        updatedAt,
      });
    });
  },
};

export default defineFeature({
  name: 'cars-overview',
  calculators: [carsOverview],
  topics: [bindState('cars.overview', carsOverview)],
});
