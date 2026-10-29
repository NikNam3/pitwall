import type { CarOverview } from '@pitwall/contracts';
import { carId, type PitStopRecord, type StintRecord, type VisualCompound } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import carsOverview from '../../../src/features/cars-overview/register.ts';
import { carState, engineView } from '../../../../../test-support/builders/index.ts';

const calculator = carsOverview.calculators[0] as QuickCalculator<CarOverview[]>;

const stop = (id: number, lap: number): PitStopRecord => ({
  carId: carId(id), lap, pitLaneEntry: 0, pitLaneExit: 0, pitLaneTimeMs: 20_000, stationaryTimeMs: 2_500, flag: 'green', penaltyServed: false,
});
const stint = (id: number, visualCompound: VisualCompound): StintRecord => ({
  carId: carId(id), firstLap: 1, lastLap: 10, actualCompound: 'C3', visualCompound, tyreAgeAtFitting: 0,
});

/** Car 0 with the game's stop count and live compound, over the given records. */
const overviewOf = (o: { numPitStops?: number; compound?: VisualCompound; pitStops?: PitStopRecord[]; stints?: StintRecord[] }) => {
  const car = carState({ timing: { numPitStops: o.numPitStops ?? 0 }, tyres: { visualCompound: o.compound ?? 'medium' } });
  const view = engineView({ cars: [car], history: { pitStops: o.pitStops ?? [], stints: o.stints ?? [] } });
  return calculator.compute(view)[0]!;
};

describe('cars.overview: reconciled stops, live compound', () => {
  it('reads the pit-stop records', () => {
    expect(calculator.reads).toEqual(expect.arrayContaining(['pitStops', 'stints']));
  });

  it('stops: the larger of the car`s pit-stop records and the game count', () => {
    expect(overviewOf({ numPitStops: 1, pitStops: [stop(0, 10), stop(0, 18), stop(1, 5)] }).stops).toBe(2);
    expect(overviewOf({ numPitStops: 1, pitStops: [] }).stops).toBe(1);
    expect(overviewOf({ numPitStops: 3, pitStops: [stop(0, 10)] }).stops).toBe(3);
  });

  it('keeps the game count (the timing is the game`s)', () => {
    expect(overviewOf({ numPitStops: 1, pitStops: [stop(0, 10), stop(0, 18)] }).timing.numPitStops).toBe(1);
  });

  it('compound: the live visual compound when the game sends it', () => {
    expect(overviewOf({ compound: 'soft', stints: [stint(0, 'hard')] }).tyres.visualCompound).toBe('soft');
  });

  // A stint record is a closed stint, so the car's latest one is the set it had before: never shown as the current tyre.
  it('compound: unknown while the game has not sent it, even when the car has an older stint record', () => {
    const stints = [stint(0, 'soft'), stint(0, 'hard'), stint(1, 'medium')];
    expect(overviewOf({ compound: 'unknown', stints }).tyres.visualCompound).toBe('unknown');
  });
});
