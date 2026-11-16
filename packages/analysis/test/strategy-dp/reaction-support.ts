// The oracle of `strategy-dp`'s reaction table (SP4.3d1 Task 4, spec §5.2), written from the solve's own values, not
// from `reaction.ts`. How these tests read the reaction table's queries (the test agent's decisions, Task 4 report):
// - `lap` is a race lap (`fromLap … totalLaps`); the reaction is the decision at the end of the SC's or VSC's first lap
//   `lap`: an SC or VSC starting on `lap` (its length by the condition's duration pmf, the solve's averaged
//   `neutral.sc/vsc` values), boxing at its end (a stop `{ lap, compound }`) or staying out.
// - `node` is a node of the solve's adaptive graph counted from its root: `0` is the car's set at `fromLap`, the solve's
//   node `adaptiveRoot + node`. `nodeAlong(t, policy, lap)` is the node after the policy's stops before `lap` (a stop
//   `{ lap: L }` counts from lap L + 1 on), each stop the child of its compound.
// - `tyreAge` is the laps already run on the set at `lap`'s start: on the car's set at `fromLap`, `carParams.tyreAge +
//   (lap − fromLap)`; on a set fitted at a stop on lap L, `lap − L − 1`.
// - The move: box onto the best child (`boxArg`) where its averaged value is below staying out's, else stay (a tie
//   stays); no finite box value (no set left, `MAX_STOPS` used, the last lap) stays.
// - `continueFrom(t, { lap, node, tyreAge })` is the table's best play from `lap`'s start at that node and age where no
//   neutralisation comes (the solve's path walk, as `boxThisLap` and `continue` read their stops): its stops, each at
//   or after `lap`.
import type { NoiseCompound, Policy } from '@pitwall/domain';
import type { DpSolution } from '../../src/strategy-dp/index.ts';

export type ReactionQuery = { lap: number; node: number; tyreAge: number; condition: 'sc' | 'vsc' };

/** The solve's node `node` counted from the adaptive root; throws when there is none. */
export function adaptiveNode(s: DpSolution, node: number): DpSolution['graph']['nodes'][number] {
  const solved = s.graph.nodes[s.adaptiveRoot + node];
  if (solved === undefined) throw new Error(`no adaptive node ${node}`);
  return solved;
}

/** How many nodes the adaptive graph holds. */
export const adaptiveCount = (s: DpSolution): number => s.graph.nodes.length - s.adaptiveRoot;

/** The adaptive node after `policy`'s stops before `lap`, walked by compound from the root. */
export function nodeOf(s: DpSolution, policy: Policy, lap: number): number {
  let node = 0;
  for (const stop of policy.stops) {
    if (stop.lap >= lap) break;
    const child = adaptiveNode(s, node).node.children.find((c) => c.compound === stop.compound);
    if (child === undefined) throw new Error(`no ${stop.compound} child at node ${node}`);
    node = child.node - s.adaptiveRoot;
  }
  return node;
}

/** The laps on the set at `lap`'s start under `policy` (its stops before `lap`). */
export function tyreAgeOf(s: DpSolution, policy: Policy, lap: number): number {
  const last = policy.stops.filter((x) => x.lap < lap).at(-1);
  return last === undefined ? s.input.carParams.tyreAge + (lap - s.input.fromLap) : lap - last.lap - 1;
}

/** The averaged move of the solve at a state: the argmin of its averaged stay and box values. */
export function averagedMove(s: DpSolution, q: ReactionQuery): 'stay' | { box: NoiseCompound } {
  const { input } = s;
  const n = input.totalLaps - input.fromLap + 1;
  const i = q.lap - input.fromLap;
  const solved = adaptiveNode(s, q.node);
  const values = solved.neutral?.[q.condition];
  if (values === undefined) throw new Error('the solve keeps no neutralised values');
  // the DP's laps on the set: since `fromLap` on the car's set, since the stop on a new one
  const j = solved.node.tyre === null ? i : q.tyreAge;
  const at = i * n + j;
  const stay = values.stay[at] ?? Infinity;
  const box = values.box?.[at] ?? Infinity;
  const child = solved.node.children[values.boxArg?.[at] ?? -1];
  return child !== undefined && box < stay ? { box: child.compound } : 'stay';
}
