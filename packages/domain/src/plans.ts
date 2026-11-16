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
