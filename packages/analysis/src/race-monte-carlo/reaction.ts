// Our car's SC/VSC reaction in one scenario (SP4.3d spec §5.2; C2, C43, C50): on the first lap of each SC or VSC that
// starts in the scenario, our car following a plan asks its reaction table (`strategy-dp`'s heaviest world's, the DP's
// averaged move, C43) once at the plan's state: its node along the plan's earlier stops and the laps on its set. Stay:
// the plan goes on (a planned stop inside the neutralisation stays). Box onto a compound: the plan's stops before the
// lap, the box at the lap's end, then the table's best continuation from the next lap instead of the plan's later stops.
// Later laps of the same neutralisation bring no second choice; the scenario's own length is never read (no hindsight).
// One out at the run's start (`hazard.active`) started before the run: the plan scored is the call made under it.
import type { Policy, Scenario, StartingPoint } from '@pitwall/domain';
import { continueFrom, nodeAlong, reactAt, type ReactionTable } from '../strategy-dp/reaction.ts';

/** The laps on car `car`'s set at `lap`'s start under `plan` (its stops before `lap`). */
function tyreAgeAt(start: StartingPoint, car: number, plan: Policy, lap: number): number {
  let last = -1;
  for (const s of plan.stops) if (s.lap < lap) last = s.lap;
  return last === -1 ? (start.tyreAge[car] ?? 0) + (lap - start.lap) : lap - last - 1;
}

/**
 * The stops car `car` plays on `plan` in a scenario with `neutralisations` under table `t`, the first `skip` of them
 * (one out at the run's start) without a choice.
 */
export function reactedPolicy(t: ReactionTable, start: StartingPoint, car: number, plan: Policy, neutralisations: Scenario['neutralisations'], skip: number): Policy {
  let policy = plan;
  for (let k = skip; k < neutralisations.length; k++) {
    const n = neutralisations[k];
    if (n === undefined) continue;
    const lap = n.fromLap;
    const move = reactAt(t, { lap, node: nodeAlong(t, policy, lap), tyreAge: tyreAgeAt(start, car, policy, lap), condition: n.kind });
    if (move === 'stay') continue;
    const boxed: Policy = { stops: [...policy.stops.filter((s) => s.lap < lap), { lap, compound: move.box }] };
    const rest = continueFrom(t, { lap: lap + 1, node: nodeAlong(t, boxed, lap + 1), tyreAge: 0 });
    policy = { stops: [...boxed.stops, ...rest.stops] };
  }
  return policy;
}
