// `strategy-dp` (SP4.3b spec §6): a simulator (C50): one car's stops and compounds to the flag by dynamic programming,
// expected over the SC/VSC chances of each lap, with the trigger thresholds. Pure, no randomness; no reads, no
// cadence, no topic.
//
// One solve (`solveDp`) holds every node's values and decisions; the result (`dpResult`) only reads it, so a caller
// that needs several reads of one input solves once (only the degradation-off threshold re-solves, a changed input).
// - `plans`: one plan per compound sequence that meets the sets and the rule with at most `MAX_STOPS` stops, best
//   first; its `expectedMs` is the expected remaining race time of the best closed-loop play making exactly that
//   sequence's stops, its `stops` that play's stops where no neutralisation comes.
// - `boxNow` / `stayOut`: the best closed-loop play (any compound at any stop) with and without a stop at the end of
//   `fromLap`; `boxNow` is `null` where no play boxing now meets the rule and the sets; `stayOut`, where no play
//   without a stop now meets the rule, is the play that ignores it.
// - `table`: per lap (index 0 = `fromLap`) for an SC now, along the best play's path where no neutralisation comes:
//   the expected remaining race time from that lap's start if an SC starts on it (its length by the SC duration pmf),
//   boxing at its end onto the best compound (`boxUnderMs`, `Infinity` where no stop can be made) and staying out
//   (`stayMs`); `sc-call` reads it (4.3b2).
// - `thresholds`: the SC/VSC lap ranges per remaining stop, damage, degradation off and rain (`thresholds.ts`).
import { defineSimulator } from '@pitwall/engine/readers';
import { adaptiveGraph, feasibleSequences, greenPath, layoutOf, nodeAt, planGraph, plansOf, solveGraph, valueAtStart, type DpNode, type GraphSolution, type Layout } from './state.ts';
import { nodesAlong, thresholdsOf } from './thresholds.ts';
import type { DpInput, DpPlan, DpResult, DpTable } from './types.ts';

export type * from './types.ts';

export const SIMULATOR = defineSimulator('strategy-dp');

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

/** The best plan of `input` alone (the plan graph only): for the degradation-off re-solves. */
function bestPlanOf(input: DpInput): DpPlan | null {
  const layout = layoutOf(input);
  const plan = planGraph(feasibleSequences(input));
  return plansOf(input, layout, solveGraph(input, layout, plan.nodes), plan.roots)[0] ?? null;
}

/** The closed-loop play from `root` with the first action forced, or `null` where it is infinite. */
function play(input: DpInput, layout: Layout, graph: GraphSolution, root: number, action: 'box' | 'stay'): DpPlan | null {
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
    boxUnderMs[i] = sc?.box[at] ?? Infinity;
    stayMs[i] = sc?.stay[at] ?? Infinity;
    if (stops[k]?.lap === input.fromLap + i && k < along.length - 1) {
      k++;
      fitted = i;
    }
  }
  return { boxUnderMs, stayMs };
}

/** Reads a solve's result: plans, box-now and stay-out, thresholds and table. */
export function dpResult(s: DpSolution): DpResult {
  const { input, layout, graph } = s;
  const plans = plansOf(input, layout, graph, s.planRoots);
  const boxNow = play(input, layout, graph, s.adaptiveRoot, 'box');
  const stayOut = play(input, layout, graph, s.adaptiveRoot, 'stay') ?? play(input, layout, solveGraph(input, layout, adaptiveGraph(input, false)), 0, 'stay');
  // without the rule every play is finite: a bug otherwise (C3)
  if (stayOut === null) throw new Error('strategy-dp: no stay-out play');
  const best = plans[0] ?? stayOut;
  const thresholds = thresholdsOf({ input, graph, adaptiveRoot: s.adaptiveRoot, best, boxNow, stayOut, bestPlanOf });
  return { plans, boxNow, stayOut, thresholds, table: tableOf(s, best.stops) };
}

/** The car's best plans, its box-now and stay-out variants and its trigger thresholds from `input.fromLap`. */
export function strategyDp(input: DpInput): DpResult {
  return dpResult(solveDp(input));
}
