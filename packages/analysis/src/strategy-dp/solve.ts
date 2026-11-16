// `strategy-dp`'s solves (SP4.3b spec §6, SP4.3b2 Task 5; SP4.3c spec §5.4, Task 19): one per weather world, each the
// plan graph and the adaptive graph of the input with that world alone, solved together. A caller holds a solution only
// inside one run (C32): `solveDp` reads every world's result from them, `bestWith` queries one, neither solves again.
import { adaptiveGraph, feasibleSequences, greenPath, layoutOf, nodeAt, planGraph, plansOf, solveGraph, valueAtStart, worldOf, type DpNode, type GraphSolution, type Layout, type Play } from './state.ts';
import type { DpInput, DpPlan, DpResult, DpTable } from './types.ts';

/** One world's solve: the plan graph and the adaptive graph, solved together. */
export type DpSolution = {
  /** The input with the solved world alone (weight 1). */
  input: DpInput;
  /** The world's index in the caller's input. */
  world: number;
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

/** `input` with world `w` alone, of weight 1: what a world's solve sees. */
function aloneIn(input: DpInput, w: number): DpInput {
  const world = input.worlds[w];
  if (world === undefined) throw new Error(`strategy-dp: no weather world ${w}`);
  return { ...input, worlds: [{ ...world, weight: 1 }] };
}

/** Solves world `w` of `input` once: every plan's and the closed-loop play's values and decisions. */
export function solveWorld(input: DpInput, w: number): DpSolution {
  const one = aloneIn(input, w);
  const layout = layoutOf(one);
  const plan = planGraph(feasibleSequences(one));
  // every node keeps its staying-out values, the adaptive nodes their boxing ones (the table)
  const graph = solveGraph(one, layout, joined(plan.nodes, adaptiveGraph(one, true)), { boxFrom: plan.nodes.length });
  return { input: one, world: w, layout, graph, planRoots: plan.roots, adaptiveRoot: plan.nodes.length };
}

/** The nodes along `stops` from `root`: `[k]` is the node after the first k stops. */
function nodesAlong(graph: GraphSolution, root: number, stops: DpPlan['stops']): number[] {
  const out = [root];
  let index = root;
  for (const s of stops) {
    const child = nodeAt(graph, index).node.children.find((c) => c.compound === s.compound);
    if (child === undefined) break;
    index = child.node;
    out.push(index);
  }
  return out;
}

/** The closed-loop play from `root` with the first action forced, or `null` where it is infinite. */
function play(input: DpInput, layout: Layout, graph: GraphSolution, root: number, action: 'box' | 'stay'): Play | null {
  const expectedMs = valueAtStart(input, layout, nodeAt(graph, root), action);
  return Number.isFinite(expectedMs) ? { stops: greenPath(input, layout, graph, root, action), expectedMs } : null;
}

/** The SC table along `stops`' path in the adaptive graph. */
function tableOf(s: DpSolution, stops: DpPlan['stops']): DpTable {
  const { input, graph } = s;
  const n = input.totalLaps - input.fromLap + 1;
  const along = nodesAlong(graph, s.adaptiveRoot, stops);
  const boxUnderMs = new Float64Array(n).fill(Infinity);
  const stayMs = new Float64Array(n).fill(Infinity);
  let k = 0;
  let fitted: number | null = null;
  for (let i = 0; i < n; i++) {
    const sc = nodeAt(graph, along[k] ?? s.adaptiveRoot).neutral?.sc;
    const at = i * n + (fitted === null ? i : i - fitted - 1);
    boxUnderMs[i] = sc?.box?.[at] ?? Infinity;
    stayMs[i] = sc?.stay[at] ?? Infinity;
    if (stops[k]?.lap === input.fromLap + i && k < along.length - 1) {
      k++;
      fitted = i;
    }
  }
  return { boxUnderMs, stayMs };
}

/** A play as a plan of the solve's world. */
export const planOf = (s: DpSolution, p: Play): DpPlan => ({ stops: p.stops, expectedMs: p.expectedMs, world: s.world });

/** One world's result: its plans (best first), box this lap, continue and the table. */
function resultOf(s: DpSolution): DpResult {
  const { input, layout, graph } = s;
  const plans = plansOf(input, layout, graph, s.planRoots).map((p) => planOf(s, p));
  const boxPlay = play(input, layout, graph, s.adaptiveRoot, 'box');
  const boxThisLap = boxPlay === null ? null : planOf(s, boxPlay);
  let stayOut: DpPlan;
  const stayPlay = play(input, layout, graph, s.adaptiveRoot, 'stay');
  if (stayPlay !== null) stayOut = planOf(s, stayPlay);
  else {
    // no play without a stop now meets the rule and the limit: the one that ignores both (always a value, C3)
    const free = solveGraph(input, layout, adaptiveGraph(input, false), { boxFrom: Infinity }, false);
    const freePlay = play(input, layout, free, 0, 'stay');
    // without the rule and the limit every play is finite: a bug otherwise (C3)
    if (freePlay === null) throw new Error('strategy-dp: no continue play');
    stayOut = planOf(s, freePlay);
  }
  const best = plans[0] ?? stayOut;
  return { plans, boxThisLap, continue: stayOut, table: tableOf(s, best.stops) };
}

/** The index of the heaviest world, the first on equal weights. */
function heaviest(input: DpInput): number {
  let at = 0;
  input.worlds.forEach((w, k) => {
    if (w.weight > (input.worlds[at]?.weight ?? -Infinity)) at = k;
  });
  return at;
}

/**
 * The car's plans per weather world (SP4.3c §5.4): each world solved alone, its best plan per stop count and compound
 * sequence, tagged with the world; `boxThisLap`, `continue` and the table are the heaviest world's.
 * `solutions`: the worlds' solves when the caller already has them (`strategy`'s job), else solved here.
 */
export function solveDp(input: DpInput, solutions: readonly DpSolution[] = input.worlds.map((_, w) => solveWorld(input, w))): DpResult {
  worldOf(input);
  const results = solutions.map(resultOf);
  const main = results[heaviest(input)] as DpResult;
  return { plans: results.flatMap((r) => r.plans), boxThisLap: main.boxThisLap, continue: main.continue, table: main.table };
}
