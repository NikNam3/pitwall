// SP4.3b Task 17 (C25, C76; spec §8.2): `latestPlan(history, carId)` gives the car's committed plan: the policy of its
// newest plan decision in the projection's decisions, `null` when that one is a `planCleared` or the car has none. A
// `calibrationChosen` and another car's plan decisions do not count. Readers get the plan here, never by their own matching.
import { describe, expect, it } from 'vitest';
import { activeSlot, carId, latestPlan, planSlots, type DecisionRecord, type Policy, type Slot } from '../src/index.ts';

const CAR = carId(0);
const MATE = carId(1);

/** A policy with every field (a stop list, SP4.3d spec §5.1): the decision carries it whole (spec §8.2). */
const POLICY: Policy = { startCompound: 'soft', stops: [{ lap: 18, compound: 'hard' }] };
const TWO_STOP: Policy = { stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'soft' }] };

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

const saved = (car: typeof CAR, slot: Slot, policy: Policy, frame: number): DecisionRecord => ({ kind: 'planSaved', carId: car, slot, policy, frame });
const removed = (car: typeof CAR, slot: Slot, frame: number): DecisionRecord => ({ kind: 'planRemoved', carId: car, slot, frame });
const activated = (car: typeof CAR, slot: Slot, policy: Policy, frame: number): DecisionRecord => ({ kind: 'planCommitted', carId: car, policy, slot, frame });

describe('planSlots and activeSlot (C25, C76; SP4.3d spec §5)', () => {
  it('save A, save B, remove B leaves { A }', () => {
    expect(planSlots(history(saved(CAR, 'A', POLICY, 1), saved(CAR, 'B', TWO_STOP, 2), removed(CAR, 'B', 3)), CAR)).toEqual({ A: POLICY });
  });

  it('saving A twice keeps the newer', () => {
    expect(planSlots(history(saved(CAR, 'A', POLICY, 1), saved(CAR, 'A', TWO_STOP, 2)), CAR)).toEqual({ A: TWO_STOP });
  });

  it('activating B makes B the active slot; a plan commit without a slot has none', () => {
    expect(activeSlot(history(saved(CAR, 'B', TWO_STOP, 1), activated(CAR, 'B', TWO_STOP, 2)), CAR)).toBe('B');
    expect(activeSlot(history(committed(CAR, POLICY, 2)), CAR)).toBeNull();
    expect(activeSlot(history(activated(MATE, 'A', POLICY, 2)), CAR)).toBeNull();
  });

  it('planCleared makes the active slot null; saves do not change it', () => {
    expect(activeSlot(history(activated(CAR, 'B', TWO_STOP, 2), cleared(CAR, 3)), CAR)).toBeNull();
    expect(activeSlot(history(activated(CAR, 'B', TWO_STOP, 2), saved(CAR, 'A', POLICY, 3)), CAR)).toBe('B');
    expect(latestPlan(history(activated(CAR, 'B', TWO_STOP, 2), saved(CAR, 'A', POLICY, 3)), CAR)).toEqual(TWO_STOP);
  });
});
