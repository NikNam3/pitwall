// SP4.3b Task 17 (C25, C76; spec §8.2): `latestPlan(history, carId)` gives the car's committed plan: the policy of its
// newest plan decision in the projection's decisions, `null` when that one is a `planCleared` or the car has none. A
// `calibrationChosen` and another car's plan decisions do not count. Readers get the plan here, never by their own matching.
import { describe, expect, it } from 'vitest';
import { carId, latestPlan, type DecisionRecord, type Policy } from '../src/index.ts';

const CAR = carId(0);
const MATE = carId(1);

/** A policy with every trigger kind, thresholds included: the decision carries it whole (spec §8.2). */
const POLICY: Policy = {
  stops: [{ lap: 18, compound: 'hard' }],
  triggers: [
    { kind: 'neutralised', condition: 'sc', fromLap: 8, toLap: 30, action: { box: 'medium' } },
    { kind: 'rain', wetnessMs: 4_000, action: { box: 'inter' } },
    { kind: 'rivalPits', carId: carId(5), withinMs: 1_500, action: 'cover' },
    { kind: 'degradationOff', wearRateDeltaPct: 20, action: { switchTo: [{ lap: 24, compound: 'medium' }] } },
    { kind: 'damage', lossMsPerLap: 800, action: { box: 'hard' } },
  ],
};
const TWO_STOP: Policy = { stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'soft' }], triggers: [] };

const committed = (car: typeof CAR, policy: Policy, frame: number): DecisionRecord => ({ kind: 'planCommitted', carId: car, policy, frame });
const cleared = (car: typeof CAR, frame: number): DecisionRecord => ({ kind: 'planCleared', carId: car, frame });
const chosen = (frame: number): DecisionRecord => ({ kind: 'calibrationChosen', setId: 'dry', snapshot: 'abc', frame });
const history = (...decisions: DecisionRecord[]) => ({ decisions });

describe('latestPlan (C25, C76)', () => {
  it('a committed plan is recorded at its frame, with its whole policy, and latestPlan returns it', () => {
    expect(latestPlan(history(), CAR)).toBeNull();
    expect(latestPlan(history(chosen(3), committed(CAR, POLICY, 40)), CAR)).toEqual(POLICY);
    // another car's plan, and a calibration choice after it, change nothing
    expect(latestPlan(history(committed(CAR, POLICY, 40), committed(MATE, TWO_STOP, 41), chosen(50)), CAR)).toEqual(POLICY);
    expect(latestPlan(history(committed(CAR, POLICY, 40)), MATE)).toBeNull();
  });

  it('a later commit replaces it; planCleared makes latestPlan null', () => {
    const replaced = history(committed(CAR, POLICY, 40), committed(CAR, TWO_STOP, 90));
    expect(latestPlan(replaced, CAR)).toEqual(TWO_STOP);
    expect(latestPlan(history(committed(CAR, POLICY, 40), cleared(CAR, 90)), CAR)).toBeNull();
    // clearing the teammate's plan leaves the car's
    expect(latestPlan(history(committed(CAR, POLICY, 40), committed(MATE, TWO_STOP, 41), cleared(MATE, 90)), CAR)).toEqual(POLICY);
    // a commit after a clear counts again
    expect(latestPlan(history(committed(CAR, POLICY, 40), cleared(CAR, 90), committed(CAR, TWO_STOP, 120)), CAR)).toEqual(TWO_STOP);
  });
});
