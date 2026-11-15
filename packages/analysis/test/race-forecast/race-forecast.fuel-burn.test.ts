// SP4.3c Task 15 (O15, C43, C50): the simulator burns the starting point's `fuelBurnKgPerLap` (the car's measured burn
// from `shared/fuel-burn.ts`, else its fuel over the laps left, set by `forecast-field`), not a `fuel ÷ laps left` of its
// own: a car burning 1.8 kg a lap with 30 kg left runs 16 laps of 1.8 kg, 1.2 kg on the 17th, and none after.
//
// A lone car from the line at lap 1, every lap-model term off but the fuel (100 ms per kg), so a lap's time over the
// pace is 100 × the fuel at its start. The fuel at the start of lap n is max(0, 30 − 1.8 (n − 1)).
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { LAP_MODEL, noStops, PACE_MS, PLAIN, startingPoint, traceAt } from './start.ts';

const LAPS = 25;
const MS_PER_KG = 100;
const lapModel = { ...LAP_MODEL, fuelMsPerKg: MS_PER_KG };
const run = (fuelKg: number, fuelBurnKgPerLap: number) =>
  raceForecast(startingPoint({ lap: 1, lapsTotal: LAPS, cars: [{ gapMs: 0, fuelKg, fuelBurnKgPerLap }], lapModel }), noStops(1), PLAIN, createRng(1), { trace: true });

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** The fuel at the start of lap `n`, at 1.8 kg a lap from 30 kg. */
const fuelAt = (n: number): number => Math.max(0, 30 - 1.8 * (n - 1));

describe("race-forecast: the starting point's fuel burn (SP4.3c Task 15, O15)", () => {
  it('a car burning 1.8 kg/lap with 30 kg left plans 16 laps of fuel: 16 full burns, 1.2 kg on lap 17, empty after', () => {
    const r = run(30, 1.8);
    for (const n of range(1, LAPS)) {
      expect(traceAt(r, n).lapTimeMs[0]! - PACE_MS, `lap ${n}`).toBeCloseTo(MS_PER_KG * fuelAt(n), 6);
    }
    expect(fuelAt(17)).toBeCloseTo(1.2, 9);
    expect(fuelAt(18)).toBe(0);
    // the race time: 25 laps of pace plus 100 ms × 265.2 kg-laps (not 30 kg over 25 laps, 390 kg-laps)
    expect(r.raceTimeMs[0]!).toBeCloseTo(LAPS * PACE_MS + MS_PER_KG * 265.2, 6);
  });

  it('the burn is read, not computed: the same fuel with another burn gives another race', () => {
    expect(run(30, 1.2).raceTimeMs[0]!).toBeCloseTo(LAPS * PACE_MS + MS_PER_KG * range(1, LAPS).reduce((s, n) => s + Math.max(0, 30 - 1.2 * (n - 1)), 0), 6);
    // no burn: the fuel stays
    expect(run(30, 0).raceTimeMs[0]!).toBeCloseTo(LAPS * (PACE_MS + MS_PER_KG * 30), 6);
  });
});
