// The prefill of slots A and B (SP4.3d spec §7.1 steps 5, 7; SP4.3d2 Task 9; C43): one rule, which the planning job and
// the race's job on the grid share. Pure (C2).
import type { McRow, Policy, Slot } from '@pitwall/domain';

/** Per stop count the index of the best row a search candidate gave (the output's `bestPerStops`). */
type BestPerStops = Partial<Record<number, number>>;

/**
 * A and B from the ranked rows: A the best row's policy; B the better ranked (the lower row index) of
 * `bestPerStops[stops(A) − 1]` and `bestPerStops[stops(A) + 1]`, none without either. Each only for a slot that is
 * empty in `saved` or whose row is infeasible (`infeasible`).
 */
export function prefillOf(rows: readonly McRow[], bestPerStops: BestPerStops, saved: Partial<Record<Slot, Policy>>, infeasible: ReadonlySet<Slot>): Partial<Record<'A' | 'B', Policy>> {
  const best = rows[0];
  if (best === undefined) return {};
  const open = (slot: 'A' | 'B'): boolean => saved[slot] === undefined || infeasible.has(slot);
  const out: Partial<Record<'A' | 'B', Policy>> = {};
  if (open('A')) out.A = best.policy;
  const stops = best.policy.stops.length;
  const neighbours = [bestPerStops[stops - 1], bestPerStops[stops + 1]].filter((i): i is number => i !== undefined);
  const b = neighbours.length === 0 ? undefined : rows[Math.min(...neighbours)];
  if (b !== undefined && open('B')) out.B = b.policy;
  return out;
}
