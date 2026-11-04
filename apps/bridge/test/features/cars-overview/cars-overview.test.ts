import type { CarOverview } from '@pitwall/contracts';
import { carId, type PitStopRecord, type StintRecord, type VisualCompound } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import carsOverview from '../../../src/features/cars-overview/register.ts';
import { carState, engineView } from '../../../../../test-support/builders/index.ts';

const calculator = carsOverview.calculators[0] as QuickCalculator<CarOverview[]>;

const stop = (id: number, lap: number): PitStopRecord => ({
  carId: carId(id), lap, pitLaneEntry: 0, pitLaneExit: 0, pitLaneTimeMs: 20_000, stationaryTimeMs: 2_500, flag: 'green', penaltyServed: false, frame: 0,
});
const stint = (id: number, visualCompound: VisualCompound): StintRecord => ({
  carId: carId(id), firstLap: 1, lastLap: 10, actualCompound: 'C3', visualCompound, tyreAgeAtFitting: 0, frame: 0,
});

/** Car 0 with its live compound, over the given records. */
const overviewOf = (o: { compound?: VisualCompound; pitStops?: PitStopRecord[]; stints?: StintRecord[] }) => {
  const car = carState({ tyres: { visualCompound: o.compound ?? 'medium' } });
  const view = engineView({ cars: [car], history: { pitStops: o.pitStops ?? [], stints: o.stints ?? [] } });
  return calculator.compute(view)[0]!;
};

describe('cars.overview: live state as it is, live compound', () => {
  it('reads the stint records and not the pit-stop records', () => {
    expect(calculator.reads).toEqual(expect.arrayContaining(['stints']));
    expect(calculator.reads).not.toContain('pitStops');
  });

  // M7-R (final review F2, C43, C54): a core topic publishes live state as it is, and the bridge makes no judgement; a
  // car's stop count is the analysis pit-stop-count's (`pitStopCount.byCar`)
  it('carries no stop count, whatever pit-stop records the projection holds', () => {
    expect(overviewOf({ pitStops: [stop(0, 10), stop(0, 18), stop(1, 5)] })).not.toHaveProperty('stops');
    expect(overviewOf({ pitStops: [] })).not.toHaveProperty('stops');
  });

  // decisions.md (Task 24 reshapes cars.overview): the confirmed laps leave the topic's timing
  it('the timing carries no confirmed laps', () => {
    expect(overviewOf({}).timing).not.toHaveProperty('confirmedLaps');
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
