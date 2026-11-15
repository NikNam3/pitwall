// SP4.3c Task 15 (O15, C43, C50): the DP's input carries the starting point's burn, `carParams.fuelBurnKgPerLap =
// start.fuelBurnKgPerLap[car]` (`forecast-field`'s, from `shared/fuel-burn.ts`), so the DP and the forecast burn alike.
import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { dpInputOn } from '../../../src/shared/strategy-input/dp-input.ts';
import { startingPoint } from '../../race-forecast/start.ts';

const hazard = { byLap: new Float64Array(30), vscByLap: new Float64Array(30), scDur: Float64Array.from([1]), vscDur: Float64Array.from([1]), active: null };

describe("the DP input's fuel burn (SP4.3c Task 15, O15)", () => {
  it("is the starting point's burn of the car, whatever its fuel and laps left", () => {
    const start = startingPoint({ lap: 5, lapsTotal: 30, cars: [{ gapMs: 0, fuelKg: 30, fuelBurnKgPerLap: 1.8 }, { gapMs: 2_000, fuelKg: 40, fuelBurnKgPerLap: 1.3 }] });
    for (const [car, burn] of [[0, 1.8], [1, 1.3]] as const) {
      const input = dpInputOn(start, carId(car), hazard, new Map(), 1_000);
      expect(input.carParams.fuelBurnKgPerLap, `car ${car}`).toBe(burn);
      expect(input.carParams.fuelKg, `car ${car}`).toBe(start.fuelKg[car]);
    }
  });
});
