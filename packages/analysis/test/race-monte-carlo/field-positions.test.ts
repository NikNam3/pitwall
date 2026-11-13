// `race-monte-carlo`'s second entry, `fieldPositions` (SP4.3b spec §8.4, Task 19; C50): every car's position pmf at
// given laps under fixed plans, a fixed scenario count, no search (`forecast-score`'s CRPS). How these tests read it:
// `support.ts`.
import type { StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { fieldPositions, type FieldInput } from '../../src/race-monte-carlo/index.ts';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { interaction, NOISY, PLAIN, startingPoint, traceAt } from '../race-forecast/start.ts';
import { byCar, hazard, NO_STOP, pmfOf, RIVAL_RULES, ZERO_HAZARD } from './support.ts';

const input = (start: StartingPoint, o: Partial<FieldInput> = {}): FieldInput => ({
  start,
  plans: byCar({ 0: NO_STOP }),
  hazard: ZERO_HAZARD(start.lapsTotal - start.lap + 1),
  rivalRules: RIVAL_RULES,
  scenarios: 200,
  laps: [3, 6],
  ...o,
});

describe('race-monte-carlo: fieldPositions', () => {
  // row 15
  it("fieldPositions: every car's pmf at every requested lap sums to 1; with zero spread it is the plain forecast's order", () => {
    const gaps = [6_000, 0, 9_000, 3_000, 15_000, 12_000];
    // with the AI field's noise (no retirements): every pmf sums to 1
    const noisy = startingPoint({ lapsTotal: 6, cars: gaps.map((gapMs) => ({ ...NOISY, retireRate: 0, gapMs })), ours: [0] });
    const drawnField = fieldPositions(input(noisy), createRng(51));
    for (let car = 0; car < gaps.length; car++) {
      const pmfs = pmfOf(drawnField, car);
      expect(pmfs).toHaveLength(2);
      for (const pmf of pmfs) {
        expect(pmf).toHaveLength(gaps.length);
        expect(pmf.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 9);
      }
    }
    // zero spread, cars 3 s apart at one pace: every scenario is the plain forecast
    const quiet = startingPoint({ lapsTotal: 6, cars: gaps.map((gapMs) => ({ gapMs })), ours: [0] });
    const plain = raceForecast(quiet, gaps.map(() => NO_STOP), PLAIN, createRng(1), { trace: true });
    const field = fieldPositions(input(quiet), createRng(52));
    [3, 6].forEach((lap, j) => {
      const at = traceAt(plain, lap).position;
      for (let car = 0; car < gaps.length; car++) expect(pmfOf(field, car)[j]![at[car]! - 1]).toBe(1);
    });
  });

  // row 16
  it('fieldPositions with a zero hazard draws no neutralisation', () => {
    // a rival 10 s behind our car and 1 s a lap faster: it reaches it only when an SC closes the field up
    const start = startingPoint({
      lapsTotal: 5,
      cars: [{ gapMs: 0 }, { gapMs: 10_000, paceMs: 89_000 }],
      ours: [0],
      interaction: interaction({ curve: { level: 30, slopePerMs: 0, cap: 1 } }),
    });
    const atFlag = (hz: FieldInput['hazard']): number[] => pmfOf(fieldPositions(input(start, { hazard: hz, laps: [5] }), createRng(61)), 1)[0]!;
    expect(atFlag(ZERO_HAZARD(5))).toEqual([0, 1]);
    // the control: an SC on lap 2 in every scenario brings the rival past
    expect(atFlag(hazard(5, { sc: { 1: 1 } }))[0]!).toBeGreaterThan(0.5);
  });
});
