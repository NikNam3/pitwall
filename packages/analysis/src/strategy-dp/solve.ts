// `strategy-dp`'s solves (SP4.3b spec §6, SP4.3b2 Task 5; SP4.3c spec §5.4, Task 19): one per weather world, each the
// plan graph and the adaptive graph of the input with that world alone, solved together. A caller holds a solution only
// inside one run (C32): `solveDp` reads every world's result from them, `bestWith` queries one, neither solves again.
// A free start (`startCompound` `null`, SP4.3d spec §7.2) is solved once per start compound with a set left
// (`freeStarts`), each on a new set of it (`solveWorld`'s `start`); its start node is the best over them.
import { NOISE_COMPOUNDS, type NoiseCompound } from '@pitwall/domain';
import { adaptiveGraph, feasibleSequences, greenPath, layoutOf, nodeAt, planGraph, plansOf, solveGraph, valueAtStart, worldOf, type DpNode, type GraphSolution, type Layout, type Play } from './state.ts';
import type { DpInput, DpPlan, DpResult, DpTable } from './types.ts';

/** One world's solve: the plan graph and the adaptive graph, solved together. */
export type DpSolution = {
  /** The input with the solved world alone (weight 1); on a free start, fixed on the new set of `start`. */
  input: DpInput;
  /** The world's index in the caller's input. */
  world: number;
  /** A free start's compound this solve starts on (its plans carry it); `null`: the car on its tyres. */
  start: NoiseCompound | null;
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

/** The compounds a free start may start on: those with a new set left (none for a car on its tyres). */
export const freeStarts = (input: DpInput): NoiseCompound[] => (input.startCompound === null ? NOISE_COMPOUNDS.filter((c) => input.sets[c] >= 1) : []);

/**
 * A free start fixed on a new set of `compound`: the car on it at age 0 and wear 0 with a new set's laps to the limit,
 * that set taken from the sets left, so the compound rule reads it as the car's compound.
 */
function fixedOn(input: DpInput, compound: NoiseCompound): DpInput {
  return {
    ...input,
    startCompound: compound,
    carParams: { ...input.carParams, compound, tyreAge: 0, wearPct: 0, fittedLapsToLimit: input.carParams.lapsToLimit[compound] },
    sets: { ...input.sets, [compound]: input.sets[compound] - 1 },
  };
}

/**
 * Solves world `w` of `input` once: every plan's and the closed-loop play's values and decisions. On a free start
 * `start` names the compound it starts on (one of `freeStarts`); for a car on its tyres it is left out. Any other call
 * is a caller's bug (C3).
 */
export function solveWorld(input: DpInput, w: number, start?: NoiseCompound): DpSolution {
  if (input.startCompound === null) {
    if (start === undefined || input.sets[start] < 1) throw new Error(`strategy-dp: a free start solved on ${start ?? 'no compound'}, not one with a set left`);
  } else if (start !== undefined) throw new Error(`strategy-dp: car ${input.car} is on its tyres, not on a free start`);
  const one = aloneIn(start === undefined ? input : fixedOn(input, start), w);
  const layout = layoutOf(one);
  const plan = planGraph(feasibleSequences(one));
  // every node keeps its staying-out values, the adaptive nodes their boxing ones (the table)
  const graph = solveGraph(one, layout, joined(plan.nodes, adaptiveGraph(one, true)), { boxFrom: plan.nodes.length });
  return { input: one, world: w, start: start ?? null, layout, graph, planRoots: plan.roots, adaptiveRoot: plan.nodes.length };
}

/** Every solve `solveDp` reads: per world, and on a free start per start compound with a set left, each world in turn. */
export function solveAll(input: DpInput): DpSolution[] {
  const worlds = input.worlds.map((_, w) => w);
  if (input.startCompound !== null) return worlds.map((w) => solveWorld(input, w));
  const starts = freeStarts(input);
  // a free start's car has new sets (the grid start's, `forecast-field`): none is a caller's bug (C3)
  if (starts.length === 0) throw new Error(`strategy-dp: car ${input.car} has a free start and no set to start on`);
  return starts.flatMap((c) => worlds.map((w) => solveWorld(input, w, c)));
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

/** A play as a plan of the solve's world, with the free start's compound where the solve has one. */
export const planOf = (s: DpSolution, p: Play): DpPlan =>
  s.start === null ? { stops: p.stops, expectedMs: p.expectedMs, world: s.world } : { startCompound: s.start, stops: p.stops, expectedMs: p.expectedMs, world: s.world };

/** One solve's result without its table: its plans (best first), box this lap, continue and whether continue keeps the rule and the limit. */
type SolveResult = { s: DpSolution; plans: DpPlan[]; boxThisLap: DpPlan | null; continue: DpPlan; keeps: boolean };

function resultOf(s: DpSolution): SolveResult {
  const { input, layout, graph } = s;
  const plans = plansOf(input, layout, graph, s.planRoots).map((p) => planOf(s, p));
  const boxPlay = play(input, layout, graph, s.adaptiveRoot, 'box');
  const boxThisLap = boxPlay === null ? null : planOf(s, boxPlay);
  const stayPlay = play(input, layout, graph, s.adaptiveRoot, 'stay');
  if (stayPlay !== null) return { s, plans, boxThisLap, continue: planOf(s, stayPlay), keeps: true };
  // no play without a stop now meets the rule and the limit: the one that ignores both (always a value, C3)
  const free = solveGraph(input, layout, adaptiveGraph(input, false), { boxFrom: Infinity }, false);
  const freePlay = play(input, layout, free, 0, 'stay');
  // without the rule and the limit every play is finite: a bug otherwise (C3)
  if (freePlay === null) throw new Error('strategy-dp: no continue play');
  return { s, plans, boxThisLap, continue: planOf(s, freePlay), keeps: false };
}

/** The plan of least expected time, the first on a tie; `null` for none. */
function least(plans: Iterable<DpPlan | null>): DpPlan | null {
  let best: DpPlan | null = null;
  for (const p of plans) if (p !== null && (best === null || p.expectedMs < best.expectedMs)) best = p;
  return best;
}

/** The index of the heaviest world, the first on equal weights: whose solve gives `boxThisLap`, the table and the reaction table. */
export function heaviest(input: DpInput): number {
  let at = 0;
  input.worlds.forEach((w, k) => {
    if (w.weight > (input.worlds[at]?.weight ?? -Infinity)) at = k;
  });
  return at;
}

/**
 * The car's plans per weather world (SP4.3c §5.4): each world solved alone, its best plan per stop count and compound
 * sequence, tagged with the world; `boxThisLap`, `continue` and the table are the heaviest world's. On a free start
 * (SP4.3d spec §7.2) each world's plans are those of every start compound, best first, each carrying its
 * `startCompound`; the start node is the best over them: `boxThisLap` the best of the starts', `continue` the best that
 * keeps the rule and the limit (else the best of all), the table that of the heaviest world's best plan's start.
 * `solutions`: the solves when the caller already has them (`strategy`'s job; `solveAll`'s), else solved here.
 */
export function solveDp(input: DpInput, solutions: readonly DpSolution[] = solveAll(input)): DpResult {
  worldOf(input);
  const results = solutions.map(resultOf);
  const ofWorld = (w: number): SolveResult[] => results.filter((r) => r.s.world === w);
  // a stable sort: one solve per world keeps its own order
  const plans = input.worlds.flatMap((_, w) => {
    const own = ofWorld(w);
    return own.length === 1 ? (own[0]?.plans ?? []) : own.flatMap((r) => r.plans).sort((a, b) => a.expectedMs - b.expectedMs);
  });
  const main = ofWorld(heaviest(input));
  if (main.length === 0) throw new Error(`strategy-dp: no solve of car ${input.car}'s heaviest world`);
  const boxThisLap = least(main.map((r) => r.boxThisLap));
  const kept = main.filter((r) => r.keeps);
  const stayOut = least((kept.length > 0 ? kept : main).map((r) => r.continue)) as DpPlan;
  const best = least(main.flatMap((r) => r.plans)) ?? stayOut;
  const from = main.find((r) => r.s.start === (best.startCompound ?? null)) ?? (main[0] as SolveResult);
  return { plans, boxThisLap, continue: stayOut, table: tableOf(from.s, best.stops) };
}
