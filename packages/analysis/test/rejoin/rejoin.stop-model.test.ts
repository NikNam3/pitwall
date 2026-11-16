// SP4.3c Task 17 (O8, B8; C43): `rejoin` calls the one stop-and-rejoin model, `race-forecast`'s `stopperRejoin`, and
// keeps no rule of its own. The built race (`field.ts`) and a hand-built starting point of the same field (`start.ts`
// of `race-forecast`'s tests: each car its offset behind the leader, car 1) give the same rejoin position under every
// condition, for a stop now. The losses are chosen so that no car lies within 500 ms of a rejoin time (neither the
// human saving nor the pit-exit yield decides a place): the cases hold whether the unit takes our car as human or not.
import { carId, type PitCondition } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { startLapOf, stopCostMs, stopperRejoin } from '../../src/race-forecast/index.ts';
import { RACE_INTERACTION_CONFIG } from '../../src/race-interaction/config.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { FORECAST_FIELD_CONFIG } from '../../src/shared/forecast-field/config.ts';
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

// SP4.3c Task 17 fix round (R55; C43, C47): a car without a car-driver span is the human's or the AI's by one rule,
// `isHumanDriver` under forecast-field's `unknownDriverIsHuman` (its owner stays forecast-field), in `rejoin` as on the
// starting point. The field puts car 8 0.3 s before our AI rejoin time under green, so the human saving (0.5 s) decides
// the place; the minimum gap is 0.1 s so that the pit-exit yield does not take it back.
describe('rejoin: a car without a car-driver span follows unknownDriverIsHuman (R55)', () => {
  const MIN_GAP = 100;
  // car 8 21.7 s behind us; our green loss 22.0 s
  const field: Field = { 1: 0, 2: 1_000, 3: 2_000, 4: 3_000, 5: 4_000, 0: 5_000, 6: 8_100, 7: 17_000, 8: 26_700, 9: 29_000, 10: 35_000, 11: 40_000 };
  const interactionConfig = { [RACE_INTERACTION_CONFIG.key]: { minGapMs: MIN_GAP } };

  /** The starting point of `field`, our car (no car-driver span) the human's exactly when `unknownDriverIsHuman` (forecast-field's rule). */
  function startAs(unknownDriverIsHuman: boolean) {
    const slots = Object.keys(field).map(Number);
    const human = unknownDriverIsHuman;
    const cars = Array.from({ length: Math.max(...slots) + 1 }, (_, slot) => ({ gapMs: field[slot] ?? 0, human: slot === US && human }));
    return startingPoint({ lap: 3, lapsTotal: 30, cars, pitLossMs: { ...LOSSES, inLapShare: 0 }, interaction: interaction({ minGapMs: MIN_GAP }) });
  }

  for (const unknownDriverIsHuman of [false, true]) {
    it(`unknownDriverIsHuman ${unknownDriverIsHuman}: rejoin's position and cost are the starting point's`, () => {
      const config = unknownDriverIsHuman ? { ...interactionConfig, [FORECAST_FIELD_CONFIG.key]: { unknownDriverIsHuman: true } } : interactionConfig;
      const { view } = rejoinCase({ field, losses: LOSSES, config });
      expect(view.situation.byMachine['car-driver'] ?? []).toEqual([]);
      const out = calc.compute(view);
      const start = startAs(unknownDriverIsHuman);
      for (const condition of ['green', 'vsc', 'sc'] as const) {
        const model = stopperRejoin(start, US, condition, startLapOf(start, US));
        const at = out.cars[carId(US)]?.conditions[condition];
        expect(at?.rejoinPosition, condition).toMatchObject({ known: true, value: model.position });
        // the cost: the ghost's interval to the car ahead is the model's gap ahead (loss less the human saving)
        const order = at?.order.known === true ? at.order.value : [];
        const ghost = order.find((r) => r.ghost);
        expect(ghost?.intervalMs, condition).toMatchObject({ known: true, value: model.gapAheadMs });
      }
      // the starting point's stop cost under green: the AI's whole loss, the human's 0.5 s less
      expect(stopCostMs(start, US, 'green')).toBe(unknownDriverIsHuman ? LOSSES.green - 500 : LOSSES.green);
    });
  }

  it('the saving decides the place: green P9 for the AI, P8 for the human', () => {
    const ai = calc.compute(rejoinCase({ field, losses: LOSSES, config: interactionConfig }).view);
    const human = calc.compute(rejoinCase({ field, losses: LOSSES, config: { ...interactionConfig, [FORECAST_FIELD_CONFIG.key]: { unknownDriverIsHuman: true } } }).view);
    expect(ai.cars[carId(US)]?.conditions.green.rejoinPosition).toMatchObject({ known: true, value: 9 });
    expect(human.cars[carId(US)]?.conditions.green.rejoinPosition).toMatchObject({ known: true, value: 8 });
  });
});
