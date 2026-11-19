// SP4.3e Task 7b, row (d) (C62d, C76; spec §4.3 "Choosing a plan in a race"): a saved plan as the plan decisions a race
// commits, `planDecisionsOf(plan, cars, current)`. `cars` maps a race number to the race's car slot that carries it
// (C62: the same car across sessions by team and race number); `current` is the feed's projection's decisions. Per car
// of the plan whose race number the race carries: `planSaved` per slot of the plan in `PLAN_SLOTS` order, then
// `planRemoved` per slot the car holds now (`planSlots` over `current`) that the plan lacks, then `planCommitted` with
// the plan's active slot. A race number the race does not carry is skipped. Pure bookkeeping, no judgement (C43).
//
// Assumes `apps/bridge/src/planning/plan-choice.ts` (new in the implement phase): the import fails until then.
import { describe, expect, it } from 'vitest';
import { carId, IMPORTED, type CarId, type DecisionRecord, type FrameNumber, type GivenDecision, type Policy, type SavedPlan } from '@pitwall/domain';
import { planDecisionsOf } from '../../src/planning/plan-choice.ts';

const POLICY_A: Policy = { startCompound: 'medium', stops: [{ lap: 20, compound: 'hard' }] };
const POLICY_B: Policy = { startCompound: 'soft', stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }] };
const POLICY_C: Policy = { startCompound: 'hard', stops: [{ lap: 25, compound: 'medium' }] };
const POLICY_G1: Policy = { startCompound: 'hard', stops: [{ lap: 40, compound: 'medium' }] };
const POLICY_OLD_A: Policy = { startCompound: 'medium', stops: [{ lap: 18, compound: 'hard' }] };

const plan = (cars: SavedPlan['cars']): SavedPlan => ({
  id: 'texas-morning',
  name: 'Texas morning',
  team: 0,
  trackId: 15,
  savedAt: '2026-11-18T09:40:00.000Z',
  computedOn: { basis: { practice: [], qualifying: { sessionUid: '2745686922413294831', weekendId: '1321303722' } }, race: { laps: 56, sets: 'carried', conditions: IMPORTED }, forecast: [], profiles: null },
  cars,
});

const at = (n: number): FrameNumber => n;
const ofCar = (decisions: readonly GivenDecision[], car: CarId): GivenDecision[] => decisions.filter((d) => 'carId' in d && d.carId === car);
/** Car 4 holds A (an older policy) and G1, G1 active. */
const CURRENT: DecisionRecord[] = [
  { kind: 'planSaved', carId: carId(4), slot: 'A', policy: POLICY_OLD_A, frame: at(10) },
  { kind: 'planSaved', carId: carId(4), slot: 'G1', policy: POLICY_G1, frame: at(10) },
  { kind: 'planCommitted', carId: carId(4), policy: POLICY_G1, slot: 'G1', frame: at(10) },
];

/** Race number 44 drives car 4 in this race, race number 63 car 7. */
const CARS = new Map<number, CarId>([[44, carId(4)], [63, carId(7)]]);

describe('planDecisionsOf (Task 7b row d; C62d, C76)', () => {
  it('(d) slots {A, B} active B on a car holding {A, G1}: planSaved A, planSaved B, planRemoved G1, planCommitted B', () => {
    const decisions = planDecisionsOf(plan([{ raceNumber: 44, slots: { A: POLICY_A, B: POLICY_B }, active: 'B' }]), CARS, CURRENT);
    expect(decisions).toEqual<GivenDecision[]>([
      { kind: 'planSaved', carId: carId(4), slot: 'A', policy: POLICY_A },
      { kind: 'planSaved', carId: carId(4), slot: 'B', policy: POLICY_B },
      { kind: 'planRemoved', carId: carId(4), slot: 'G1' },
      { kind: 'planCommitted', carId: carId(4), policy: POLICY_B, slot: 'B' },
    ]);
  });

  it('a race with no plan decisions yet: planSaved per slot in PLAN_SLOTS order, then planCommitted, per car by race number', () => {
    const decisions = planDecisionsOf(plan([
      { raceNumber: 63, slots: { G1: POLICY_G1, A: POLICY_A }, active: 'A' },
      { raceNumber: 44, slots: { C: POLICY_C }, active: 'C' },
    ]), CARS, []);
    expect(ofCar(decisions, carId(7))).toEqual<GivenDecision[]>([
      { kind: 'planSaved', carId: carId(7), slot: 'A', policy: POLICY_A },
      { kind: 'planSaved', carId: carId(7), slot: 'G1', policy: POLICY_G1 },
      { kind: 'planCommitted', carId: carId(7), policy: POLICY_A, slot: 'A' },
    ]);
    expect(ofCar(decisions, carId(4))).toEqual<GivenDecision[]>([
      { kind: 'planSaved', carId: carId(4), slot: 'C', policy: POLICY_C },
      { kind: 'planCommitted', carId: carId(4), policy: POLICY_C, slot: 'C' },
    ]);
    expect(decisions).toHaveLength(5);
  });

  it('a race number the race does not carry is skipped', () => {
    const decisions = planDecisionsOf(plan([
      { raceNumber: 99, slots: { A: POLICY_A }, active: 'A' },
      { raceNumber: 44, slots: { B: POLICY_B }, active: null },
    ]), CARS, []);
    // race number 99 drives no car; race number 44's B saved, no active slot: no planCommitted
    expect(decisions).toEqual<GivenDecision[]>([{ kind: 'planSaved', carId: carId(4), slot: 'B', policy: POLICY_B }]);
  });

  it('the active policy is a copy: committing it never shares the plan\'s object', () => {
    const p = plan([{ raceNumber: 44, slots: { A: POLICY_A }, active: 'A' }]);
    const committed = planDecisionsOf(p, CARS, []).find((d: GivenDecision) => d.kind === 'planCommitted');
    expect(committed).toEqual({ kind: 'planCommitted', carId: carId(4), policy: POLICY_A, slot: 'A' });
    if (committed?.kind === 'planCommitted') expect(committed.policy).not.toBe(p.cars[0]!.slots.A);
  });
});
