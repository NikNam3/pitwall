// `strategy-dp`'s state space and its one backward solve (SP4.3b spec §6). A state is a lap, a node (the set on the car
// and what is left to do with stops), the laps on the set (the integer tyre age) and the neutralisation with its laps
// left. Two kinds of node graph share the solve:
// - the adaptive graph: a node is the compound on the car and the multiset of compounds fitted so far (so the sets
//   left, the stop count and whether the compound rule is met); every stop may pick any compound with a set left. It
//   gives the closed-loop box-now and stay-out values and the per-lap table.
// - the plan graph: a node is the compound on the car and the compound sequence still to fit; a stop fits only the
//   sequence's next compound. Each feasible sequence's root gives that plan's expected time.
// The model: a stop at lap L boxes at the end of lap L, costs lap L's condition's pit loss (green, VSC, SC) less the
// human saving plus lap L's traffic cost; an SC or VSC and its length are known from the lap it starts on; none starts
// on the lap after one ends. Wear is the set's laps times the wear rate (exact where neutralised laps wear as green
// ones; where the wear is hidden, the rate is 0 and the age terms remain) and fuel is the green burn per lap from
// `fromLap`. Pure, no randomness (C2).
import { NOISE_COMPOUNDS, type LapInput, type NoiseCompound } from '@pitwall/domain';
import { lapTimeMs } from '../lap-model/index.ts';
import { HUMAN_STOP_SAVING_MS } from '../race-forecast/constants.ts';
import type { DpInput, DpPlan } from './types.ts';

/** At most this many stops from `fromLap` (spec §6, §11.1 `strategy`'s maximum stops). */
export const MAX_STOPS = 3;

/** The dry compounds the compound rule counts (the second dry compound, `compound-rule`). */
export const DRY_COMPOUNDS: readonly NoiseCompound[] = ['soft', 'medium', 'hard'];

const CONDITIONS = ['none', 'sc', 'vsc'] as const;
const COND_SC = 1;
const COND_VSC = 2;

/** The neutralisation states at a lap's start: 0 green, 1 green with no start possible, then SC and VSC laps left. */
const NS_GREEN = 0;
const NS_NO_START = 1;

/** A node: the set on the car (`null` = the set the car is on at `fromLap`) and the stops it can make. */
export type DpNode = {
  tyre: NoiseCompound | null;
  /** The stops it can make: the compound and the node after it. */
  children: { compound: NoiseCompound; node: number }[];
  /** The value past the flag: 0, or `Infinity` where its stops are not all made (or the rule not met). */
  terminal: number;
};

/** The neutralisation states: each one's condition and the state after it. */
export type Layout = {
  ns: number;
  condOf: Int8Array;
  nextOf: Int8Array;
  /** The state of a lap neutralised by `condition` with `left` laps after it. */
  stateOf: (condition: 'sc' | 'vsc', left: number) => number;
};

export function layoutOf(input: DpInput): Layout {
  const activeLen = input.active?.remaining.length ?? 0;
  const scLen = Math.max(input.hazard.scDur.length, input.active?.condition === 'sc' ? activeLen : 0);
  const vscLen = Math.max(input.hazard.vscDur.length, input.active?.condition === 'vsc' ? activeLen : 0);
  const ns = 2 + scLen + vscLen;
  const condOf = new Int8Array(ns);
  const nextOf = new Int8Array(ns);
  nextOf[NS_GREEN] = NS_GREEN;
  nextOf[NS_NO_START] = NS_GREEN;
  for (let k = 0; k < scLen; k++) {
    condOf[2 + k] = COND_SC;
    nextOf[2 + k] = k === 0 ? NS_NO_START : 2 + k - 1;
  }
  for (let k = 0; k < vscLen; k++) {
    condOf[2 + scLen + k] = COND_VSC;
    nextOf[2 + scLen + k] = k === 0 ? NS_NO_START : 2 + scLen + k - 1;
  }
  return { ns, condOf, nextOf, stateOf: (condition, left) => (condition === 'sc' ? 2 + left : 2 + scLen + left) };
}

const ruleMet = (input: DpInput, fitted: readonly NoiseCompound[]): boolean =>
  !input.owesSecondCompound || fitted.some((c) => DRY_COMPOUNDS.includes(c) && c !== input.carParams.compound);

const countOf = (fitted: readonly NoiseCompound[], c: NoiseCompound): number => fitted.filter((f) => f === c).length;

/** The adaptive graph from the car's set: node 0 is the root. `rule: false` drops the compound rule. */
export function adaptiveGraph(input: DpInput, rule: boolean): DpNode[] {
  const nodes: DpNode[] = [];
  const byKey = new Map<string, number>();
  const visit = (tyre: NoiseCompound | null, fitted: NoiseCompound[]): number => {
    const key = `${tyre ?? ''}|${NOISE_COMPOUNDS.map((c) => countOf(fitted, c)).join(',')}`;
    const seen = byKey.get(key);
    if (seen !== undefined) return seen;
    const index = nodes.length;
    const node: DpNode = { tyre, children: [], terminal: !rule || ruleMet(input, fitted) ? 0 : Infinity };
    nodes.push(node);
    byKey.set(key, index);
    if (fitted.length < MAX_STOPS) {
      for (const c of NOISE_COMPOUNDS) {
        if (input.sets[c] - countOf(fitted, c) > 0) node.children.push({ compound: c, node: visit(c, [...fitted, c]) });
      }
    }
    return index;
  };
  visit(null, []);
  return nodes;
}

/** Every compound sequence of at most `MAX_STOPS` stops within the sets that meets the rule. */
export function feasibleSequences(input: DpInput): NoiseCompound[][] {
  const out: NoiseCompound[][] = [];
  const left = { ...input.sets };
  const walk = (acc: NoiseCompound[]): void => {
    if (ruleMet(input, acc)) out.push([...acc]);
    if (acc.length === MAX_STOPS) return;
    for (const c of NOISE_COMPOUNDS) {
      if (left[c] <= 0) continue;
      left[c]--;
      acc.push(c);
      walk(acc);
      acc.pop();
      left[c]++;
    }
  };
  walk([]);
  return out;
}

/** The plan graph: one root per sequence (`roots[k]` for `sequences[k]`), the nodes after a stop shared by suffix. */
export function planGraph(sequences: readonly NoiseCompound[][]): { nodes: DpNode[]; roots: number[] } {
  const nodes: DpNode[] = [];
  const byKey = new Map<string, number>();
  const visit = (tyre: NoiseCompound | null, rest: readonly NoiseCompound[]): number => {
    const key = `${tyre ?? ''}|${rest.join('-')}`;
    const seen = byKey.get(key);
    if (seen !== undefined) return seen;
    const index = nodes.length;
    const node: DpNode = { tyre, children: [], terminal: rest.length === 0 ? 0 : Infinity };
    nodes.push(node);
    byKey.set(key, index);
    const [head, ...tail] = rest;
    if (head !== undefined) node.children.push({ compound: head, node: visit(head, tail) });
    return index;
  };
  const roots = sequences.map((s) => visit(null, s));
  return { nodes, roots };
}

/** The laps on the set at lap offset i that a node's states cover: the car's set has i, a new set 0 … i − 1. */
const ageRange = (tyre: NoiseCompound | null, i: number): [number, number] => (tyre === null ? [i, i] : [0, i - 1]);

/** A set's lap time per condition, lap offset i and laps on the set j (`[(cond * n + i) * n + j]`). */
function lapTable(input: DpInput, n: number, fuel: Float64Array, tyre: NoiseCompound | null): Float64Array {
  const p = input.carParams;
  const compound = tyre ?? p.compound;
  const rate = p.wearRatePct?.[compound] ?? 0;
  const lap: LapInput = { paceMs: p.paceMs, degMsPerLap: p.degMsPerLap, wearPct: 0, fuelKg: 0, compound, lapOnSet: 1, neutralised: 'none', wetnessMs: 0, scatterMs: 0, mistakeMs: 0 };
  const table = new Float64Array(CONDITIONS.length * n * n);
  for (let i = 0; i < n; i++) {
    lap.fuelKg = fuel[i] ?? 0;
    lap.wetnessMs = input.wetnessByLap[i] ?? 0;
    const [jFrom, jTo] = ageRange(tyre, i);
    for (let j = jFrom; j <= jTo; j++) {
      lap.wearPct = tyre === null ? p.wearPct + rate * i : rate * j;
      lap.lapOnSet = tyre === null ? p.tyreAge + i + 1 : j + 1;
      CONDITIONS.forEach((cond, c) => {
        lap.neutralised = cond;
        table[(c * n + i) * n + j] = lapTimeMs(input.lap, lap);
      });
    }
  }
  return table;
}

/** Per lap offset the fuel at the lap's start: the green burn that runs it to empty at the flag. */
function fuelByLap(input: DpInput, n: number): Float64Array {
  const burn = input.carParams.fuelKg / n;
  const fuel = new Float64Array(n);
  let kg = input.carParams.fuelKg;
  for (let i = 0; i < n; i++) {
    fuel[i] = kg;
    kg = Math.max(0, kg - burn);
  }
  return fuel;
}

/** A neutralisation starting at a state: its expected value boxing onto the best child and staying out. */
export type NeutralValues = { box: Float64Array; boxArg: Int8Array; stay: Float64Array };

/** What the solve keeps of a node. */
export type SolvedNode = {
  node: DpNode;
  /** Per `(i * n + j) * ns + state` the stop made at the lap's end: −1 none, else the child's index. */
  decisions: Int8Array;
  /** At lap offset 0 per state: the value, the value forced to box (best child) with that child, forced to stay. */
  first: Float64Array;
  firstBox: Float64Array;
  firstBoxArg: Int8Array;
  firstStay: Float64Array;
  /** Per `i * n + j` the values of an SC and a VSC starting on that lap, where the solve keeps them. */
  neutral: { sc: NeutralValues; vsc: NeutralValues } | null;
};

export type GraphSolution = { nodes: SolvedNode[] };

/** A node of a solve; a missing index is a bug (C3). */
export function nodeAt(graph: GraphSolution, index: number): SolvedNode {
  const node = graph.nodes[index];
  if (node === undefined) throw new Error(`strategy-dp: no node ${index}`);
  return node;
}

type Work = { solved: SolvedNode; kids: Work[]; lt: Float64Array; cur: Float64Array; next: Float64Array };

/** A neutralisation kind as a lap starting one sees it: its condition, duration pmf and first state. */
type NeutralKind = { key: 'sc' | 'vsc'; cond: number; dur: Float64Array; first: number };

/** The expected value after a lap that starts `kind`, from a node's next-lap values at `offset` (its pmf renormalised). */
function after(kind: NeutralKind, from: Float64Array, offset: number): number {
  let v = 0;
  let mass = 0;
  for (let k = 0; k < kind.dur.length; k++) {
    const p = kind.dur[k] ?? 0;
    if (p <= 0) continue;
    v += p * (from[offset + (k === 0 ? NS_NO_START : kind.first + k - 1)] ?? Infinity);
    mass += p;
  }
  return mass > 0 ? v / mass : Infinity;
}

const neutralValues = (size: number): NeutralValues => ({ box: new Float64Array(size).fill(Infinity), boxArg: new Int8Array(size).fill(-1), stay: new Float64Array(size).fill(Infinity) });

/** Solves `nodes` backward from the flag to `fromLap`; the nodes from `neutralFrom` on keep their neutralised values. */
export function solveGraph(input: DpInput, layout: Layout, nodes: readonly DpNode[], neutralFrom = Infinity): GraphSolution {
  const n = input.totalLaps - input.fromLap + 1;
  const { ns, condOf, nextOf } = layout;
  const fuel = fuelByLap(input, n);
  const tables = new Map<NoiseCompound | null, Float64Array>();
  const tableOf = (tyre: NoiseCompound | null): Float64Array => {
    const seen = tables.get(tyre);
    if (seen !== undefined) return seen;
    const table = lapTable(input, n, fuel, tyre);
    tables.set(tyre, table);
    return table;
  };
  const human = input.carParams.human ? HUMAN_STOP_SAVING_MS : 0;
  const loss = [input.pitLossMs.green, input.pitLossMs.sc, input.pitLossMs.vsc];
  const stop = (cond: number, i: number): number => (loss[cond] ?? Infinity) - human + (input.trafficMsByLap[i] ?? 0);
  const { byLap, vscByLap, scDur, vscDur } = input.hazard;
  const scState = layout.stateOf('sc', 0);
  const vscState = layout.stateOf('vsc', 0);

  const width = (n + 1) * ns;
  const works: Work[] = nodes.map((node, d) => ({
    solved: {
      node,
      decisions: new Int8Array(n * n * ns).fill(-1),
      first: new Float64Array(ns),
      firstBox: new Float64Array(ns).fill(Infinity),
      firstBoxArg: new Int8Array(ns).fill(-1),
      firstStay: new Float64Array(ns),
      neutral: d >= neutralFrom ? { sc: neutralValues(n * n), vsc: neutralValues(n * n) } : null,
    },
    kids: [],
    lt: tableOf(node.tyre),
    cur: new Float64Array(width),
    next: new Float64Array(width),
  }));
  works.forEach((w) => {
    for (const child of w.solved.node.children) {
      const kid = works[child.node];
      if (kid === undefined) throw new Error(`strategy-dp: no node ${child.node}`);
      w.kids.push(kid);
    }
  });
  const neutralKinds: readonly NeutralKind[] = [
    { key: 'sc', cond: COND_SC, dur: scDur, first: scState },
    { key: 'vsc', cond: COND_VSC, dur: vscDur, first: vscState },
  ];
  const keepNeutral = (solved: SolvedNode, kids: readonly Work[], i: number, j: number, last: boolean, lt: Float64Array, self: Float64Array): void => {
    // an SC or VSC starting this lap, its length by its pmf: boxing onto the best child, and staying out
    const at = i * n + j;
    for (const kind of neutralKinds) {
      const target = solved.neutral?.[kind.key];
      if (target === undefined) return;
      const ms = lt[(kind.cond * n + i) * n + j] ?? Infinity;
      if (last) {
        target.stay[at] = ms + solved.node.terminal;
        continue;
      }
      target.stay[at] = ms + after(kind, self, (j + 1) * ns);
      const cost = stop(kind.cond, i);
      for (let c = 0; c < kids.length; c++) {
        const kid = kids[c];
        if (kid === undefined) continue;
        const box = ms + cost + after(kind, kid.next, 0);
        if (box < (target.box[at] ?? Infinity)) {
          target.box[at] = box;
          target.boxArg[at] = c;
        }
      }
    }
  };

  for (let i = n - 1; i >= 0; i--) {
    const last = i === n - 1;
    const pSc = byLap[i] ?? 0;
    const pVsc = vscByLap[i] ?? 0;
    const pGreen = 1 - pSc - pVsc;
    const stopCost = [stop(0, i), stop(COND_SC, i), stop(COND_VSC, i)];
    for (const w of works) {
      const { solved, kids, lt } = w;
      const { node, decisions } = solved;
      const self = w.next;
      const out = w.cur;
      const [jFrom, jTo] = ageRange(node.tyre, i);
      for (let j = jFrom; j <= jTo; j++) {
        const row = j * ns;
        for (let s = 1; s < ns; s++) {
          const cond = condOf[s] ?? 0;
          const ms = lt[(cond * n + i) * n + j] ?? Infinity;
          const nx = nextOf[s] ?? NS_GREEN;
          let stay = node.terminal;
          let boxBest = Infinity;
          let boxArg = -1;
          if (!last) {
            stay = self[(j + 1) * ns + nx] ?? Infinity;
            const cost = stopCost[cond] ?? Infinity;
            for (let c = 0; c < kids.length; c++) {
              const v = cost + (kids[c]?.next[nx] ?? Infinity);
              if (v < boxBest) {
                boxBest = v;
                boxArg = c;
              }
            }
          }
          const boxes = boxBest < stay;
          out[row + s] = ms + (boxes ? boxBest : stay);
          decisions[(i * n + j) * ns + s] = boxes ? boxArg : -1;
          if (i === 0) {
            solved.firstStay[s] = ms + stay;
            solved.firstBox[s] = ms + boxBest;
            solved.firstBoxArg[s] = boxArg;
          }
        }
        let green = 0;
        if (pGreen > 0) green += pGreen * (out[row + NS_NO_START] ?? Infinity);
        for (let k = 0; k < scDur.length; k++) {
          const p = pSc * (scDur[k] ?? 0);
          if (p > 0) green += p * (out[row + scState + k] ?? Infinity);
        }
        for (let k = 0; k < vscDur.length; k++) {
          const p = pVsc * (vscDur[k] ?? 0);
          if (p > 0) green += p * (out[row + vscState + k] ?? Infinity);
        }
        out[row + NS_GREEN] = green;
        if (solved.neutral !== null) keepNeutral(solved, kids, i, j, last, lt, self);
      }
      if (i === 0) solved.first.set(out.subarray(0, ns));
    }
    for (const w of works) [w.cur, w.next] = [w.next, w.cur];
  }
  return { nodes: works.map((w) => w.solved) };
}

/** The value at `fromLap` of a solved node, its first lap's action free (`'free'`), forced to box or to stay. */
export function valueAtStart(input: DpInput, layout: Layout, solved: SolvedNode, action: 'free' | 'box' | 'stay'): number {
  const of = action === 'free' ? solved.first : action === 'box' ? solved.firstBox : solved.firstStay;
  const at = (state: number): number => of[state] ?? Infinity;
  const { active } = input;
  if (active !== null) {
    let v = 0;
    active.remaining.forEach((p, k) => {
      if (p > 0) v += p * at(layout.stateOf(active.condition, k));
    });
    return v;
  }
  if (action === 'free') return at(NS_GREEN);
  const { byLap, vscByLap, scDur, vscDur } = input.hazard;
  const pSc = byLap[0] ?? 0;
  const pVsc = vscByLap[0] ?? 0;
  let v = 0;
  if (1 - pSc - pVsc > 0) v += (1 - pSc - pVsc) * at(NS_NO_START);
  scDur.forEach((p, k) => {
    if (pSc * p > 0) v += pSc * p * at(layout.stateOf('sc', k));
  });
  vscDur.forEach((p, k) => {
    if (pVsc * p > 0) v += pVsc * p * at(layout.stateOf('vsc', k));
  });
  return v;
}

/**
 * A node's path where no neutralisation comes (an active one ends on its first possible lap): its stops.
 * `firstAction` forces the action at the end of `fromLap`.
 */
export function greenPath(input: DpInput, layout: Layout, graph: GraphSolution, root: number, firstAction: 'free' | 'box' | 'stay' = 'free'): DpPlan['stops'] {
  const n = input.totalLaps - input.fromLap + 1;
  const stops: DpPlan['stops'] = [];
  let s = NS_NO_START;
  if (input.active !== null) s = layout.stateOf(input.active.condition, Math.max(0, input.active.remaining.findIndex((p) => p > 0)));
  let index = root;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const solved = nodeAt(graph, index);
    const decided = solved.decisions[(i * n + j) * layout.ns + s] ?? -1;
    const arg = i > 0 || firstAction === 'free' ? decided : firstAction === 'box' ? (solved.firstBoxArg[s] ?? -1) : -1;
    const nextS = layout.nextOf[s] ?? NS_GREEN;
    s = nextS === NS_GREEN ? NS_NO_START : nextS;
    const child = solved.node.children[arg];
    if (child !== undefined) {
      stops.push({ lap: input.fromLap + i, compound: child.compound });
      index = child.node;
      j = 0;
    } else j = solved.node.tyre === null ? i + 1 : j + 1;
  }
  return stops;
}

/** The feasible plans of a plan-graph solve, best first: per sequence root its expected time and its green path. */
export function plansOf(input: DpInput, layout: Layout, graph: GraphSolution, roots: readonly number[]): DpPlan[] {
  const plans: DpPlan[] = [];
  for (const root of roots) {
    const expectedMs = valueAtStart(input, layout, nodeAt(graph, root), 'free');
    if (Number.isFinite(expectedMs)) plans.push({ stops: greenPath(input, layout, graph, root), expectedMs });
  }
  return plans.sort((a, b) => a.expectedMs - b.expectedMs);
}
