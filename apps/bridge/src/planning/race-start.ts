// The race-start commit's decisions (SP4.3d spec §7.0 rules 7–8, §7.1 step 8; C62, C62d, C76): the prepared plans of a
// race as plan decisions for the race's car slots. A prepared car goes to the slot of our team that carries its race
// number (C62: the same car across the weekend's sessions), car by car in the race's slot order; per car its slots in
// `PLAN_SLOTS` order, then `planCommitted` with the active slot. A race number no slot of our team carries is skipped.
// No lap range check (§7.0 rule 7). Bookkeeping, no judgement (C43).
import { carId, PLAN_SLOTS, type CarKey, type PreparedPlans, type TeamId } from '@pitwall/domain';
import type { PlanDecision } from '../pipeline/team-feeds.ts';

/** `plans` as the decisions the race commits; `slots`: each car slot's team and race number (Participants), by slot. */
export function raceStartDecisions(plans: PreparedPlans, team: TeamId, slots: ReadonlyArray<CarKey | undefined>): PlanDecision[] {
  return slots.flatMap((key, slot): PlanDecision[] => {
    if (key === undefined || key.teamId !== team) return [];
    const prepared = plans.cars.find((c) => c.raceNumber === key.raceNumber);
    if (prepared === undefined) return [];
    const car = carId(slot);
    const saved = PLAN_SLOTS.flatMap((s): PlanDecision[] => {
      const policy = prepared.slots[s];
      return policy === undefined ? [] : [{ kind: 'planSaved', carId: car, slot: s, policy }];
    });
    const active = prepared.active === null ? undefined : prepared.slots[prepared.active];
    return active === undefined || prepared.active === null
      ? saved
      : [...saved, { kind: 'planCommitted', carId: car, policy: structuredClone(active), slot: prepared.active }];
  });
}
