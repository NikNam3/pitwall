// SP4.3c Task 17 (O8, B8; C43): `rejoin` calls the one stop-and-rejoin model, `race-forecast`'s `stopperRejoin`, and
// keeps no rule of its own. The built race (`field.ts`) and a hand-built starting point of the same field (`start.ts`
// of `race-forecast`'s tests: each car its offset behind the leader, car 1) give the same rejoin position under every
// condition, for a stop now. The losses are chosen so that no car lies within 500 ms of a rejoin time (neither the
// human saving nor the pit-exit yield decides a place): the cases hold whether the unit takes our car as human or not.
import { carId, type PitCondition } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { startLapOf, stopperRejoin } from '../../src/race-forecast/index.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { interaction, startingPoint } from '../race-forecast/start.ts';
import { guardedQuick } from '../situated.ts';
import { FIELD, rejoinCase, US, type Field } from './field.ts';

const calc = guardedQuick(rejoinCalculator);

const LOSSES: Record<PitCondition, number> = { green: 22_000, vsc: 13_100, sc: 9_800 };

/** The starting point of `field` (car slot → offset behind the leader) with `LOSSES`, on the leader's lap 3. */
function startOf(field: Field) {
  const slots = Object.keys(field).map(Number);
  const cars = Array.from({ length: Math.max(...slots) + 1 }, (_, slot) => ({ gapMs: field[slot] ?? 0 }));
  return startingPoint({ lap: 3, lapsTotal: 30, cars, pitLossMs: { ...LOSSES, inLapShare: 0 }, interaction: interaction({ minGapMs: 500 }) });
}

describe('rejoin: the one stop-and-rejoin model (SP4.3c Task 17, O8)', () => {
  it("the standard field: each condition's rejoin position is stopperRejoin's for the same starting point", () => {
    const out = calc.compute(rejoinCase({ losses: LOSSES }).view);
    const start = startOf(FIELD);
    for (const condition of ['green', 'vsc', 'sc'] as const) {
      const expected = stopperRejoin(start, US, condition, startLapOf(start, US)).position;
      expect(out.cars[carId(US)]?.conditions[condition].rejoinPosition, condition).toMatchObject({ known: true, value: expected });
    }
    // the standard field's places: green P9, VSC P8, SC P7
    expect(stopperRejoin(start, US, 'green', startLapOf(start, US)).position).toBe(9);
  });

  it('a field with a car right behind us and one far back: the same positions', () => {
    // car 6 0.8 s behind us, car 7 at +15 s, car 8 at +40 s
    const field: Field = { 1: 0, 2: 1_000, 3: 2_000, 4: 3_000, 5: 4_000, 0: 5_000, 6: 5_800, 7: 20_000, 8: 45_000 };
    const out = calc.compute(rejoinCase({ field, losses: LOSSES }).view);
    const start = startOf(field);
    for (const condition of ['green', 'vsc', 'sc'] as const) {
      const expected = stopperRejoin(start, US, condition, startLapOf(start, US)).position;
      expect(out.cars[carId(US)]?.conditions[condition].rejoinPosition, condition).toMatchObject({ known: true, value: expected });
    }
  });
});
