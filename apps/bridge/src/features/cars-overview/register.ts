import type { CarOverview } from '@pitwall/contracts';
import type { CarId, VisualCompound } from '@pitwall/domain';
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
 * Every car's identity, timing and tyres, with the stop count and compound reconciled: the game's count can lag a
 * recorded stop, and the live compound is `unknown` while the game has not sent it (the latest stint record has it).
 */
const carsOverview: QuickCalculator<CarOverview[]> = {
  id: 'cars.overview',
  kind: 'quick',
  // `updatedAt` moves with every source, so it reads every area a source feeds.
  reads: ['identity', 'timing', 'tyres', 'condition', 'dynamics', 'ownCar', 'laps', 'stints', 'pitStops'],
  cadence: { hz: 10 },
  compute: ({ state }) => {
    const stops = byCar(state.history.pitStops);
    const stints = byCar(state.history.stints);
    return state.cars.map(({ id, identity, timing, tyres, updatedAt }) => {
      const stintCompound: VisualCompound | undefined = stints.get(id)?.at(-1)?.visualCompound;
      const visualCompound = tyres.visualCompound === 'unknown' && stintCompound !== undefined ? stintCompound : tyres.visualCompound;
      return structuredClone({
        id,
        identity,
        timing,
        tyres: { actualCompound: tyres.actualCompound, visualCompound, age: tyres.age },
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
