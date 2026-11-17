// The plan decisions (C76, SP4.3b spec §8.2): the car's newest `planCommitted` or `planCleared` in the projection's
// decisions decides its plan; readers get it here, never by their own matching (C25).
import type { Policy } from './forecast.ts';
import type { CarId } from './ids.ts';
import { PLAN_SLOTS, type Slot } from './plan-slots.ts';
import type { DecisionRecord } from './records.ts';

// The slot names live in `plan-slots.ts` (a leaf, so `records.ts` can use them without a cycle).
export { PLAN_SLOTS, type Slot };

/** The car's committed plan: its newest plan decision's policy, `null` when cleared or never committed. */
export function latestPlan(history: { readonly decisions: readonly DecisionRecord[] }, carId: CarId): Policy | null {
  const newest = history.decisions.findLast((d) => (d.kind === 'planCommitted' || d.kind === 'planCleared') && d.carId === carId);
  return newest?.kind === 'planCommitted' ? newest.policy : null;
}


/** The car's saved plans: per slot its newest `planSaved` policy, minus a slot whose newest decision is a `planRemoved`. */
export function planSlots(history: { readonly decisions: readonly DecisionRecord[] }, carId: CarId): Partial<Record<Slot, Policy>> {
  const slots = new Map<Slot, Policy>();
  for (const d of history.decisions) {
    if (d.kind === 'planSaved' && d.carId === carId) slots.set(d.slot, d.policy);
    else if (d.kind === 'planRemoved' && d.carId === carId) slots.delete(d.slot);
  }
  return Object.fromEntries(slots);
}

/** The slot of the car's newest plan decision when it is a `planCommitted`; `null` without one, after `planCleared`, or when that commit names no slot. */
export function activeSlot(history: { readonly decisions: readonly DecisionRecord[] }, carId: CarId): Slot | null {
  const newest = history.decisions.findLast((d) => (d.kind === 'planCommitted' || d.kind === 'planCleared') && d.carId === carId);
  return newest?.kind === 'planCommitted' ? (newest.slot ?? null) : null;
}

/** One car's prepared plans of the planning round (SP4.3d spec §7.4): by race number, its slots and its active slot. */
export type PreparedCar = { raceNumber: number; slots: Partial<Record<Slot, Policy>>; active: Slot | null };

/** A team's prepared plans for one race: the entered race laps (`null` until entered) and per car its prepared plans. */
export type PreparedPlans = { laps: number | null; cars: PreparedCar[] };

const same = (a: Policy, b: Policy): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The car's active plan (SP4.3d1 R32, one owner, C43): the committed policy (`latestPlan`) and the slot it stands in: the
 * slot it was activated from while that slot still holds the same policy, else the first slot (in `PLAN_SLOTS` order)
 * holding it, else none (a plan committed without a slot, or a slot saved again after its activation). `null` without
 * a committed plan.
 */
export function activePlan(history: { readonly decisions: readonly DecisionRecord[] }, carId: CarId): { policy: Policy; slot: Slot | null } | null {
  const policy = latestPlan(history, carId);
  if (policy === null) return null;
  const slots = planSlots(history, carId);
  const holds = (slot: Slot): boolean => slots[slot] !== undefined && same(slots[slot], policy);
  const from = activeSlot(history, carId);
  return { policy, slot: from !== null && holds(from) ? from : (PLAN_SLOTS.find(holds) ?? null) };
}
