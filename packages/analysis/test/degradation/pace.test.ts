// `degradation` owns a car's pace (SP4.3c Task 13, spec §5.3 O2, B9; C3, C43): the fuel-corrected base pace, its line
// and the residuals.
//  - `fuelIncluded`: a stint's base pace fitted on lap times without fuel (`fuelCorrected: false`) holds the car's fuel;
//    such a base pace is marked `fuelIncluded: true` (forecast-field then gives the lap model no fuel term for it). A
//    fuel-corrected stint's base pace is `fuelIncluded: false`.
//  - `fieldResiduals(laps, usable)`: per car, per lap number, the lap's residual: its lap time minus the field's median lap
//    time of that lap number over the laps `usable` keeps (the race's fuel and tyre trend cancel). Only the laps `usable`
//    keeps have a residual. `race-interaction`'s pace advantage reads it (it computes no residual itself).
import { carId, unknown, type CarId, type LapRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { carState, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { fieldResiduals, type StintDegradation } from '../../src/degradation/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { stintLaps } from './support.ts';

const calc = guardedQuick(degradationCalculator);

/** Our car 0 and rival 1 (realism-hidden), the projection holding `laps`; a race. */
const view = (laps: LapRecord[]): EngineView => situatedView({ cars: [carState(), realismHidden(carState({ id: carId(1) }))], history: { laps } });

/** The stints of car `car`, oldest first. */
const stintsOf = (v: EngineView, car: number): StintDegradation[] => {
  const stints = calc.compute(v)[carId(car)];
  if (stints === undefined) throw new Error(`no stints for car ${car}`);
  return stints;
};

describe("degradation: a base pace's fuel (B9)", () => {
  it('a stint fitted on lap times (every pace lap`s fuel unknown) has its fuel in its base pace: fuelIncluded', () => {
    const ours = stintLaps({ from: 1, to: 6, fuelAtFrom: 100 });
    const rival = stintLaps({ car: 1, from: 1, to: 6, fuelAtFrom: 94 }).map((l) => ({ ...l, fuelAtStartKg: unknown('restricted'), fuelAtEndKg: unknown('restricted') }));
    const r = stintsOf(view([...ours, ...rival]), 1)[0]!;
    expect(r.fuelCorrected).toBe(false);
    expect(r.basePaceMs.known).toBe(true);
    expect(r.fuelIncluded).toBe(true);
  });

  it('a fuel-corrected stint`s base pace holds no fuel: fuelIncluded false (our car, and a rival filled with our fuel)', () => {
    const ours = stintLaps({ from: 1, to: 6, fuelAtFrom: 100 });
    const rival = stintLaps({ car: 1, from: 1, to: 6, fuelAtFrom: 94, hidden: true });
    const v = view([...ours, ...rival]);
    for (const car of [0, 1]) {
      const s = stintsOf(v, car)[0]!;
      expect(s.fuelCorrected, `car ${car}`).toBe(true);
      expect(s.fuelIncluded, `car ${car}`).toBe(false);
    }
  });
});

describe('degradation: fieldResiduals (O2)', () => {
  /** Car `car`'s lap `n` of `ms`. */
  const at = (car: number, n: number, ms: number): LapRecord => lap({ carId: carId(car), lapNumber: n, lapTimeMs: ms, completedAt: n * 90_000 });
  // lap 2: 90.0, 90.4, 91.0 s (median 90.4); lap 3: 89.8, 90.6, 90.2 s (median 90.2); car 2's lap 3 left out by `usable`
  const laps = [at(0, 2, 90_000), at(1, 2, 90_400), at(2, 2, 91_000), at(0, 3, 89_800), at(1, 3, 90_600), at(2, 3, 99_000)];
  const usable = (car: CarId, n: number): boolean => !(car === 2 && n === 3);

  it("a lap's residual is its time less the field's median lap of that lap number over the usable laps", () => {
    const r = fieldResiduals(laps, usable);
    expect(r.get(carId(0))?.get(2)).toBe(-400);
    expect(r.get(carId(1))?.get(2)).toBe(0);
    expect(r.get(carId(2))?.get(2)).toBe(600);
    // lap 3's field is cars 0 and 1 only: median 90.2 s
    expect(r.get(carId(0))?.get(3)).toBe(-400);
    expect(r.get(carId(1))?.get(3)).toBe(400);
  });

  it('a lap usable leaves out has no residual', () => {
    const r = fieldResiduals(laps, usable);
    expect(r.get(carId(2))?.has(3) ?? false).toBe(false);
    // nothing usable: no residual at all
    const none = fieldResiduals(laps, () => false);
    expect([...none.values()].reduce((n, m) => n + m.size, 0)).toBe(0);
  });
});
