// `strategy-dp`'s one solve (SP4.3b spec §6, SP4.3b2 Task 5): the plan graph and the adaptive graph of an input, solved
// together. A caller holds a solution only inside one run (C32): `dpResult` reads the result from it, `bestWith` queries
// it, neither solves again.
import { adaptiveGraph, feasibleSequences, layoutOf, planGraph, solveGraph, type DpNode, type GraphSolution, type Layout } from './state.ts';
import type { DpInput } from './types.ts';

/** One solve of an input: the plan graph and the adaptive graph, solved together. */
export type DpSolution = {
  input: DpInput;
  layout: Layout;
  graph: GraphSolution;
  /** The plan roots, one per feasible sequence. */
  planRoots: number[];
  /** The adaptive graph's root. */
  adaptiveRoot: number;
};

/** The plan graph's and the adaptive graph's nodes in one list: the adaptive nodes after the plan nodes. */
function joined(plan: readonly DpNode[], adaptive: readonly DpNode[]): DpNode[] {
  const offset = plan.length;
  return [...plan, ...adaptive.map((d) => ({ ...d, children: d.children.map((c) => ({ compound: c.compound, node: c.node + offset })) }))];
}

/** Solves `input` once: every plan's and the closed-loop play's values and decisions. */
export function solveDp(input: DpInput): DpSolution {
  const layout = layoutOf(input);
  const plan = planGraph(feasibleSequences(input));
  const graph = solveGraph(input, layout, joined(plan.nodes, adaptiveGraph(input, true)), plan.nodes.length);
  return { input, layout, graph, planRoots: plan.roots, adaptiveRoot: plan.nodes.length };
}
