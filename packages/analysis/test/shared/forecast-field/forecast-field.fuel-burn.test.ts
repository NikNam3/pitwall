// SP4.3c Task 15 (O15, C43, C50): `forecast-field` fills `StartingPoint.fuelBurnKgPerLap` from `shared/fuel-burn.ts`:
// per car `planBurnKgPerLap(burnPerLapKg(its laps), its fuel, its laps left)`, the car's measured burn (the median of its
// rate laps' own burns, `fuel`'s rule) where one is known, else its starting-point fuel over its laps left. The laps
// left are whole laps from where the car starts, `lapsTotal − startLapOf(sp, car) + 1` (the test agent's choice: a
// whole count keeps the as-of and the live builds equal, which differ only in lap fraction and gap).
import { carId, type LapRecord, type StartingPoint } from '@pitwall/domain';
import { asOfNow } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { LAP_CLASSES_CONFIG } from '../../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../../src/per-lap-rate/index.ts';
import { startLapOf } from '../../../src/race-forecast/index.ts';
import { buildStartingPoint } from '../../../src/shared/forecast-field/index.ts';
import { burnPerLapKg, planBurnKgPerLap } from '../../../src/shared/fuel-burn.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

const OPTS = { lapClasses: LAP_CLASSES_CONFIG.defaults, rate: PER_LAP_RATE_CONFIG.defaults };
const g = generated();

function startAt(lap: number): { sp: StartingPoint; laps: readonly LapRecord[] } {
  const view = materialised(asOfNow(g.viewAt(g.race.framesOfLap(lap)[0]!)));
  const sp = buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, [6, 7], view.at)));
  if (!sp.known) throw new Error(`lap ${lap}: the starting point is unknown (${sp.reason})`);
  return { sp: sp.value, laps: view.history.laps as readonly LapRecord[] };
}

describe("forecast-field: the fuel burn (SP4.3c Task 15, O15)", () => {
  it("each car's burn is its measured burn, else its fuel over its whole laps left", () => {
    for (const lap of [3, 7]) {
      const { sp, laps } = startAt(lap);
      let measured = 0;
      for (let k = 0; k < sp.cars; k++) {
        if (sp.retired[k] === 1) continue;
        const burn = burnPerLapKg(laps.filter((l) => l.carId === carId(k)), OPTS);
        if (burn.known) measured++;
        const expected = planBurnKgPerLap(burn, sp.fuelKg[k]!, sp.lapsTotal - startLapOf(sp, k) + 1);
        expect(sp.fuelBurnKgPerLap[k]!, `lap ${lap}, car ${k}`).toBeCloseTo(expected, 9);
        if (burn.known) expect(sp.fuelBurnKgPerLap[k]!, `lap ${lap}, car ${k}: a burn`).toBeGreaterThan(0);
      }
      // the generator race's laps carry the fuel: by lap 7 every running car has a measured burn
      if (lap === 7) expect(measured).toBe(sp.cars - sp.retired.reduce((s, r) => s + r, 0));
    }
  });
});
