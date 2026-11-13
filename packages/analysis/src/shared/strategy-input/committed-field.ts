// The committed teammates of one car's call (SP4.3b2 Task 18f; C43): one rule for `strategy`, `pit-sweep`, `undercut`
// and `sc-call`. A car of ours is certain input only when it is in the planned field (`plannedCars`) and committed; its
// plan is followed as far as it can be (spec §8.2, `followable`). Pure (C2).
import type { CarId, McRow, NoiseCompound, Policy, StartingPoint } from '@pitwall/domain';
import { startLapOf } from '../../race-forecast/index.ts';
import { plannedCars, plannedField } from './dp-input.ts';
import type { StrategyInput } from './input.ts';

type Infeasible = McRow['infeasible'];

/**
 * A committed policy as far as car `car` can follow it (spec §8.2): a passed stop boxes this lap (one stop a lap), a
 * stop onto a compound without a set left is dropped (the car keeps its tyres); the reason, the first found.
 */
export function followable(start: StartingPoint, car: CarId, policy: Policy): { policy: Policy; infeasible: Infeasible } {
  const fromLap = startLapOf(start, car);
  let infeasible: Infeasible = null;
  const onLaps: Policy['stops'] = [];
  for (const s of policy.stops) {
    if (s.lap < fromLap) infeasible ??= 'stopLapPassed';
    const lap = Math.max(s.lap, fromLap);
    const last = onLaps.at(-1);
    if (last !== undefined && last.lap >= lap) continue;
    onLaps.push({ lap, compound: s.compound });
  }
  const left = new Map<NoiseCompound, number>();
  for (const s of start.sets[car] ?? []) left.set(s.compound, (left.get(s.compound) ?? 0) + 1);
  const stops: Policy['stops'] = [];
  for (const s of onLaps) {
    const n = left.get(s.compound) ?? 0;
    if (n <= 0) {
      infeasible ??= 'noSetLeft';
      continue;
    }
    left.set(s.compound, n - 1);
    stops.push(s);
  }
  return { policy: infeasible === null ? policy : { stops, triggers: policy.triggers }, infeasible };
}

/**
 * Car `car`'s call's committed field: each other car of ours in the planned field with a commit, its committed policy as
 * far as it can follow it (a passed stop boxes this lap, a stop onto a compound without a set left is dropped). A car of
 * ours absent from it is modelled like a rival; `car` itself is not in it. Empty without a starting point.
 */
export function committedField(input: StrategyInput, car: CarId): Record<CarId, Policy | null> {
  const out: Record<CarId, Policy | null> = {};
  if (!input.start.known) return out;
  const start = input.start.value;
  const planned = plannedCars(input, start);
  const field = plannedField(start, planned);
  for (const mate of planned) {
    const plan = input.committed[mate] ?? null;
    if (mate === car || plan === null) continue;
    out[mate] = followable(field, mate, plan).policy;
  }
  return out;
}
