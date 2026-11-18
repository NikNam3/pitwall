// `weekend-pace` without a basis (SP4.3e Task 6, spec G5 and §4.4 item 7; contract C3): with nothing to build on,
// nothing fails or guesses. A basis of none (`view.basis` with `sessions: []`), no player known (`view.basis`
// absent) or a basis without any qualifying evidence in the field: no stand-in, every car without its own evidence
// stays `unknown('insufficientData')`; the grid start built on it is `unknown('insufficientData')`, no throw.
//
// Rows (plan Task 6 Step 1): 1 no basis, 2 grid start, 3 no qualifying evidence.
import { carId, unknown, type CarId, type WeekendPace } from '@pitwall/domain';
import { asOfNow, type CalculatorId } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, WEEKEND_PACE, WEEKEND_PACE_CONFIG } from '../../src/index.ts';
import { DRIVER_NOISE } from '../../src/driver-noise/index.ts';
import { RACE_INTERACTION } from '../../src/race-interaction/index.ts';
import { buildGridStart } from '../../src/shared/forecast-field/index.ts';
import { stintLaps, stintRecord } from '../degradation/support.ts';
import { plainInteraction, plainNoise } from '../shared/forecast-field/support.ts';
import { PRACTICE } from '../situated.ts';
import { basisOf, calc, INSUFFICIENT, seats, stored, valueOf, viewOf } from './support.ts';

const CARS = 6;

/** Every car of the output, and every car unknown('insufficientData'). */
function expectAllInsufficient(out: WeekendPace, label: string): void {
  expect(Object.keys(out).length, label).toBe(CARS);
  for (const [car, pace] of Object.entries(out)) expect(pace, `${label}: car ${car}`).toEqual(INSUFFICIENT);
}

describe('weekend-pace without a basis (SP4.3e Task 6)', () => {
  it("1. no basis: view.basis with sessions: [] (and view.basis absent), no own qualifying → every car unknown('insufficientData')", () => {
    expectAllInsufficient(calc.compute(viewOf({ seats: seats(CARS), basis: basisOf([]) })), 'sessions: []');
    expectAllInsufficient(calc.compute(viewOf({ seats: seats(CARS) })), 'view.basis absent');
  });

  it("2. grid start: buildGridStart on the no-basis weekend-pace returns unknown('insufficientData'), no throw", () => {
    const view = viewOf({ seats: seats(CARS), basis: basisOf([]) });
    const pace = calc.compute(view);
    const outputs = new Map<CalculatorId, unknown>([
      [DRIVER_NOISE, plainNoise(CARS)],
      [RACE_INTERACTION, plainInteraction()],
      [DEGRADATION, view.outputs.get(DEGRADATION)],
      [WEEKEND_PACE, pace],
    ]);
    const grid = Array.from({ length: CARS }, (_, k) => carId(k));
    const build = () => buildGridStart(asOfNow(view), outputs, { laps: 30, grid, fittedCompound: (_: CarId) => unknown('notApplicable'), race: { laps: 30, sets: 'carried' } });
    expect(build).not.toThrow();
    expect(build()).toEqual(INSUFFICIENT);
  });

  it("3. no qualifying evidence: a basis of practice only, one car's long run → no stand-in, every other car unknown('insufficientData')", () => {
    const flying = Math.max(9, WEEKEND_PACE_CONFIG.defaults.minLongRunLaps | 1);
    const laps = stintLaps({ car: 3, from: 1, to: 1 + flying, nu: 150, visual: 'medium', actual: 'C2', over: { 1: { outLap: true, lapTimeMs: 110_000 } } });
    const stint = stintRecord({ carId: carId(3), firstLap: 1, lastLap: 1 + flying, actualCompound: 'C2', visualCompound: 'medium' });
    const fp = stored('fp2', PRACTICE, seats(CARS), { laps, stints: [stint] });
    const out = calc.compute(viewOf({ seats: seats(CARS), basis: basisOf([fp]) }));
    expect(valueOf(out, 3).source).toBe('longRun');
    for (const car of [0, 1, 2, 4, 5]) expect(out[carId(car)], `car ${car}`).toEqual(INSUFFICIENT);
  });
});
