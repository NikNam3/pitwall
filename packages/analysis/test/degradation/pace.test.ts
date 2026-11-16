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
import { DEGRADATION_CONFIG, fieldResiduals, type StintDegradation } from '../../src/degradation/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { BASE_MS, stintLaps } from './support.ts';

const calc = guardedQuick(degradationCalculator);

/** Our car 0 and rival 1 (realism-hidden), the projection holding `laps`; a race. */
const view = (laps: LapRecord[]): EngineView => situatedView({ cars: [carState(), realismHidden(carState({ id: carId(1) }))], history: { laps } });

/** The stints of car `car`, oldest first. */
const stintsOf = (v: EngineView, car: number): StintDegradation[] => {
  const stints = calc.compute(v).stints[carId(car)];
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

// SP4.3c Task 13 fix round 2 (R47; C3, C43): a car's stint list holds only stints of laps the car drove. The stand-in for
// a competing car without any lap is its own part of the output, one for the field: `standIn`, known only while the
// leading lap is lap 1 and some car in the session has no lap, else `notApplicable`. Its car is degradation's judgement
// (the car with the most laps, the first to complete its newest): `fromCarId`; its values are those of the stand-in
// stint before this round (the lap less its fuel term plus `noLapStandInOffsetMs`, 0 by default; the default ν and sd;
// the lap's visual compound; parts `leader stand-in`).
describe("degradation: the field's stand-in (fix round 2, R47)", () => {
  /** Our car 0 (soft), rival 1 (medium, first to complete lap 1) and car 2 (no lap yet); a race. */
  const field = (laps: LapRecord[]): EngineView =>
    situatedView({ cars: [carState(), carState({ id: carId(1) }), carState({ id: carId(2) })], history: { laps } });
  // rival 1 completes lap 1 at 87 000 + γ·100 ms (from 0), our car 2 s later: the rival is the stand-in's car
  const rival = stintLaps({ car: 1, from: 1, to: 1, actual: 'C2', visual: 'medium' });
  const ours = stintLaps({ from: 1, to: 1, noise: () => 2_000 });
  const defaults = DEGRADATION_CONFIG.defaults;

  it("a car without a lap has no stint; every stint is of the car's own laps", () => {
    const out = calc.compute(field([...ours, ...rival]));
    expect(out.stints[carId(2)] ?? []).toEqual([]);
    for (const car of [0, 1]) {
      const stints = out.stints[carId(car)] ?? [];
      expect(stints, `car ${car}`).toHaveLength(1);
      expect(stints[0]!.laps.map((l) => l.lapNumber), `car ${car}: its own lap`).toEqual([1]);
      expect(stints[0]!.source.parts, `car ${car}`).not.toBe('leader stand-in');
    }
    expect(out.stints[carId(0)]![0]!.visual).toBe('soft');
  });

  it('one stand-in for the field: the first car to complete lap 1, its lap less its fuel term, the default ν and sd', () => {
    const out = calc.compute(field([...ours, ...rival]));
    expect(out.standIn.known).toBe(true);
    if (!out.standIn.known) return;
    const s = out.standIn.value;
    expect(s.fromCarId).toBe(carId(1));
    expect(s.lapNumber).toBe(1);
    // the rival's lap is BASE_MS + γ · its fuel at the start: less the fuel term, BASE_MS (the offset is 0)
    expect(s.basePaceMs).toBe(BASE_MS + defaults.noLapStandInOffsetMs);
    expect(s.fuelIncluded).toBe(false);
    expect(s.nuMsPerLap).toBe(defaults.defaultNuMsPerLap);
    expect(s.nuSdMs).toBe(defaults.defaultNuSdMs);
    expect(s.compound).toBe('medium');
    expect(s.source.parts).toBe('leader stand-in');
    expect(s.source.kind).toBe('default');
  });

  it('the stand-in follows noLapStandInOffsetMs; a lap whose fuel is unknown stands in with its fuel (fuelIncluded)', () => {
    const offset = calc.compute(situatedView({
      cars: [carState(), carState({ id: carId(1) }), carState({ id: carId(2) })],
      history: { laps: [...ours, ...rival] },
      config: { [DEGRADATION_CONFIG.key]: { noLapStandInOffsetMs: 500 } },
    }));
    expect(offset.standIn.known && offset.standIn.value.basePaceMs).toBe(BASE_MS + 500);
    const hidden = rival.map((l) => ({ ...l, fuelAtStartKg: unknown('restricted'), fuelAtEndKg: unknown('restricted') }));
    const raw = calc.compute(field([...stintLaps({ from: 1, to: 1, noise: () => 2_000 }), ...hidden]));
    expect(raw.standIn.known).toBe(true);
    if (!raw.standIn.known) return;
    expect(raw.standIn.value.fromCarId).toBe(carId(1));
    expect(raw.standIn.value.fuelIncluded).toBe(true);
    expect(raw.standIn.value.basePaceMs).toBe(hidden[0]!.lapTimeMs);
  });

  it('notApplicable when no car needs it, before any lap, and past lap 1', () => {
    // every car has a lap
    const all = calc.compute(field([...ours, ...rival, ...stintLaps({ car: 2, from: 1, to: 1, noise: () => 4_000 })]));
    expect(all.standIn).toEqual(unknown('notApplicable'));
    // no car has a lap
    expect(calc.compute(field([])).standIn).toEqual(unknown('notApplicable'));
    // the leading lap is lap 2: car 2 without a lap is missing data, no stand-in and no stint
    const past = calc.compute(field([...stintLaps({ from: 1, to: 2 }), ...stintLaps({ car: 1, from: 1, to: 2, actual: 'C2', visual: 'medium' })]));
    expect(past.standIn).toEqual(unknown('notApplicable'));
    expect(past.stints[carId(2)] ?? []).toEqual([]);
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
