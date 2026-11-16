// `strategy-dp`'s state space and its one backward solve (SP4.3b spec §6; SP4.3c spec §5.4). A state is a lap, a node
// (the set on the car and what is left to do with stops), the laps on the set (the integer tyre age) and the
// neutralisation with its laps left. Two kinds of node graph share the solve:
// - the adaptive graph: a node is the compound on the car and the multiset of compounds fitted so far (so the sets
//   left, the stop count and whether the compound rule is met); every stop may pick any compound with a set left. It
//   gives the closed-loop box-this-lap and continue values and the per-lap table.
// - the plan graph: a node is the compound on the car and the compound sequence still to fit; a stop fits only the
//   sequence's next compound. Each feasible sequence's root gives that plan's expected time.
// The model: a stop at lap L boxes at the end of lap L, costs lap L's condition's pit loss (green, VSC, SC) less the
// human saving plus lap L's traffic cost; an SC or VSC and its length are known from the lap it starts on; none starts
// on the lap after one ends. Each compound runs on its own tyre terms (ν and wear rate, SP4.3c Task 12, B5). Wear is the
// set's laps times its compound's wear rate (exact where neutralised laps wear as green ones; where the wear is hidden,
// the rate is 0 and the age terms remain) and fuel is the green burn per lap from `fromLap`. A solve is of one weather
// world (`worlds[0]` of its input, `solve.ts`): its wetness and traffic per lap. The 70 % limit (SP4.3c §5.2): no lap
// starts on a set past its laps to the limit (the fitted set at least `fromLap`). Pure, no randomness (C2).
import { NOISE_COMPOUNDS, type LapInput, type NoiseCompound } from '@pitwall/domain';
import { lapTimeMs } from '../lap-model/index.ts';
import { stopCostOf } from '../race-forecast/stop.ts';
import type { DpInput, DpPlan, DpWorld } from './types.ts';

/** At most this many stops from `fromLap` (spec §6, §11.1 `strategy`'s maximum stops). */
export const MAX_STOPS = 3;

/** The dry compounds the compound rule counts (the second dry compound, `compound-rule`). */
export const DRY_COMPOUNDS: readonly NoiseCompound[] = ['soft', 'medium', 'hard'];

const CONDITIONS = ['none', 'sc', 'vsc'] as const;
export const COND_SC = 1;
export const COND_VSC = 2;

/** The neutralisation states at a lap's start: 0 green, 1 green with no start possible, then SC and VSC laps left. */
export const NS_GREEN = 0;
export const NS_NO_START = 1;

/** A play of a solve: its stops where no neutralisation comes and its expected remaining race time. */
export type Play = Pick<DpPlan, 'stops' | 'expectedMs'>;

/** The world a solve's input is of: its first (a solve's input holds that one alone, `solve.ts`); none is a bug (C3). */
export function worldOf(input: DpInput): DpWorld {
  const world = input.worlds[0];
  if (world === undefined) throw new Error('strategy-dp: an input without a weather world');
  return world;
}

/** The laps a set may run (the 70 % limit): the fitted set's (`null`) from `fromLap`, at least 1; a new set's; `Infinity` unknown. */
export function stintLimit(input: DpInput, tyre: NoiseCompound | null): number {
  const p = input.carParams;
  if (tyre === null) return p.fittedLapsToLimit === null ? Infinity : Math.max(1, p.fittedLapsToLimit);
  return p.lapsToLimit[tyre] ?? Infinity;
}

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
  /** Per condition how many laps-left states the layout holds (`left` 0 … length − 1). */
  lengths: { sc: number; vsc: number };
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
  return { ns, condOf, nextOf, lengths: { sc: scLen, vsc: vscLen }, stateOf: (condition, left) => (condition === 'sc' ? 2 + left : 2 + scLen + left) };
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

/** A set's lap time per condition, lap offset i and laps on the set j (`[(cond * n + i) * n + j]`), on its compound's terms. */
function lapTable(input: DpInput, n: number, fuel: Float64Array, tyre: NoiseCompound | null): Float64Array {
  const p = input.carParams;
  const compound = tyre ?? p.compound;
  const rate = p.wearRatePct?.[compound] ?? 0;
  const wetness = worldOf(input).wetnessByLap;
  const lap: LapInput = { paceMs: p.paceMs, degMsPerLap: p.degMsPerLap[compound], wearPct: 0, fuelKg: 0, compound, lapOnSet: 1, neutralised: 'none', wetnessMs: 0, wet: false, scatterMs: 0, mistakeMs: 0 };
  const table = new Float64Array(CONDITIONS.length * n * n);
  for (let i = 0; i < n; i++) {
    lap.fuelKg = fuel[i] ?? 0;
    lap.wetnessMs = wetness[i] ?? 0;
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

/** Per lap offset the fuel at the lap's start: the car's green burn per lap (the starting point's, O15), never below 0. */
function fuelByLap(input: DpInput, n: number): Float64Array {
  const burn = input.carParams.fuelBurnKgPerLap;
  const fuel = new Float64Array(n);
  let kg = input.carParams.fuelKg;
  for (let i = 0; i < n; i++) {
    fuel[i] = kg;
    kg = Math.max(0, kg - burn);
  }
  return fuel;
}

/** A stop at the end of lap offset i under condition `cond` (0 green, SC, VSC): the stop model's cost (`race-forecast`), plus the world's traffic. */
export function stopCostMs(input: DpInput, cond: number, i: number): number {
  const condition = cond === COND_SC ? 'sc' : cond === COND_VSC ? 'vsc' : 'green';
  return stopCostOf(input.pitLossMs, input.carParams.human, condition) + (worldOf(input).trafficMsByLap[i] ?? 0);
}

/** A neutralisation starting at a state: its expected value staying out and (where kept) boxing onto the best child. */
export type NeutralValues = { stay: Float64Array; box: Float64Array | null; boxArg: Int8Array | null };

/** What a solve keeps of the neutralised values: none (a re-solve), staying out per node and boxing from `boxFrom` on. */
export type KeepNeutral = { boxFrom: number } | null;

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
  /**
   * Per `i * ns + state` the value from lap offset i's start at the node's entry age: the car's set at i laps for the
   * car's set, a new set (0 laps) otherwise; `Infinity` where the node holds no such state (a new set at offset 0).
   */
  entry: Float64Array;
};

/** A solve: its nodes, per tyre its lap times (`[(cond * n + i) * n + j]`, as `lapTable`) and its layout. */
export type GraphSolution = { nodes: SolvedNode[]; lapTimes: ReadonlyMap<NoiseCompound | null, Float64Array>; layout: Layout };

/** A node of a solve; a missing index is a bug (C3). */
export function nodeAt(graph: GraphSolution, index: number): SolvedNode {
  const node = graph.nodes[index];
  if (node === undefined) throw new Error(`strategy-dp: no node ${index}`);
  return node;
}

type Work = { solved: SolvedNode; kids: Work[]; lt: Float64Array; limit: number; cur: Float64Array; next: Float64Array };

/** A neutralisation kind as a lap starting one sees it: its condition, duration pmf and first state. */
export type NeutralKind = { key: 'sc' | 'vsc'; cond: number; dur: Float64Array; first: number };

/** The SC and the VSC kinds of an input in its layout. */
export const neutralKindsOf = (input: DpInput, layout: Layout): readonly NeutralKind[] => [
  { key: 'sc', cond: COND_SC, dur: input.hazard.scDur, first: layout.stateOf('sc', 0) },
  { key: 'vsc', cond: COND_VSC, dur: input.hazard.vscDur, first: layout.stateOf('vsc', 0) },
];

/** The expected value after a lap that starts `kind`, from a node's next-lap values at `offset` (its pmf renormalised). */
export function after(kind: NeutralKind, from: Float64Array, offset: number): number {
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

/** `after` for one kind with its pmf's states and chances read once: the same sum in the same order. */
function afterOf(kind: NeutralKind): (from: Float64Array, offset: number) => number {
  const states: number[] = [];
  const chances: number[] = [];
  let mass = 0;
  for (let k = 0; k < kind.dur.length; k++) {
    const p = kind.dur[k] ?? 0;
    if (p <= 0) continue;
    states.push(k === 0 ? NS_NO_START : kind.first + k - 1);
    chances.push(p);
    mass += p;
  }
  const m = states.length;
  return (from, offset) => {
    if (!(mass > 0)) return Infinity;
    let v = 0;
    for (let k = 0; k < m; k++) v += (chances[k] ?? 0) * (from[offset + (states[k] ?? 0)] ?? Infinity);
    return v / mass;
  };
}

const neutralValues = (size: number, box: boolean): NeutralValues => ({
  stay: new Float64Array(size).fill(Infinity),
  box: box ? new Float64Array(size).fill(Infinity) : null,
  boxArg: box ? new Int8Array(size).fill(-1) : null,
});

/**
 * Solves `nodes` backward from the flag to `fromLap`; `keep` says which neutralised values it keeps (none by default);
 * `limit: false` drops the 70 % limit.
 */
export function solveGraph(input: DpInput, layout: Layout, nodes: readonly DpNode[], keep: KeepNeutral = null, limit = true): GraphSolution {
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
  const stop = (cond: number, i: number): number => stopCostMs(input, cond, i);
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
      neutral: keep === null ? null : { sc: neutralValues(n * n, d >= keep.boxFrom), vsc: neutralValues(n * n, d >= keep.boxFrom) },
      entry: new Float64Array(n * ns).fill(Infinity),
    },
    kids: [],
    lt: tableOf(node.tyre),
    limit: limit ? stintLimit(input, node.tyre) : Infinity,
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
  const kinds = neutralKindsOf(input, layout).map((kind) => ({ kind, after: afterOf(kind) }));
  // per lap, the best stop of a node: it lands on a new set (age 0) whatever the age it leaves, so it does not depend on
  // the laps on the set; computed once per node and lap, not per age
  const boxBestOf = new Float64Array(ns);
  const boxArgOf = new Int8Array(ns);
  const neutralBoxOf = new Float64Array(kinds.length);
  const neutralArgOf = new Int8Array(kinds.length);
  // per lap the chance of each state at a green lap's start (none, then each SC and VSC length), in the sum's order
  const greenStates = new Int32Array(ns);
  const greenWeights = new Float64Array(ns);

  for (let i = n - 1; i >= 0; i--) {
    const last = i === n - 1;
    const pSc = byLap[i] ?? 0;
    const pVsc = vscByLap[i] ?? 0;
    const pGreen = 1 - pSc - pVsc;
    let greens = 0;
    const weigh = (state: number, p: number): void => {
      if (!(p > 0)) return;
      greenStates[greens] = state;
      greenWeights[greens] = p;
      greens++;
    };
    weigh(NS_NO_START, pGreen);
    for (let k = 0; k < scDur.length; k++) weigh(scState + k, pSc * (scDur[k] ?? 0));
    for (let k = 0; k < vscDur.length; k++) weigh(vscState + k, pVsc * (vscDur[k] ?? 0));
    const stopCost = [stop(0, i), stop(COND_SC, i), stop(COND_VSC, i)];
    for (const w of works) {
      const { solved, kids, lt } = w;
      const { node, decisions, neutral } = solved;
      const self = w.next;
      const out = w.cur;
      const [jFrom, jTo] = ageRange(node.tyre, i);
      boxBestOf.fill(Infinity);
      boxArgOf.fill(-1);
      neutralBoxOf.fill(Infinity);
      neutralArgOf.fill(-1);
      if (!last) {
        for (let s = 1; s < ns; s++) {
          const cost = stopCost[condOf[s] ?? 0] ?? Infinity;
          const nx = nextOf[s] ?? NS_GREEN;
          for (let c = 0; c < kids.length; c++) {
            const v = cost + (kids[c]?.next[nx] ?? Infinity);
            if (v < (boxBestOf[s] ?? Infinity)) {
              boxBestOf[s] = v;
              boxArgOf[s] = c;
            }
          }
        }
        if (neutral !== null) {
          kinds.forEach(({ kind, after: afterKind }, k) => {
            const cost = stopCost[kind.cond] ?? Infinity;
            for (let c = 0; c < kids.length; c++) {
              const kid = kids[c];
              if (kid === undefined) continue;
              const v = cost + afterKind(kid.next, 0);
              if (v < (neutralBoxOf[k] ?? Infinity)) {
                neutralBoxOf[k] = v;
                neutralArgOf[k] = c;
              }
            }
          });
        }
      }
      // the 70 % limit: no lap starts on a set that has run its laps (the car's set: i laps since `fromLap`)
      const jLast = node.tyre === null ? (i < w.limit ? jTo : jFrom - 1) : Math.min(jTo, w.limit - 1);
      if (jLast < jTo) out.fill(Infinity, Math.max(jFrom, jLast + 1) * ns, (jTo + 1) * ns);
      const lapAt = (cond: number): number => (cond * n + i) * n;
      const at0 = lapAt(0);
      const at1 = lapAt(1);
      const at2 = lapAt(2);
      for (let j = jFrom; j <= jLast; j++) {
        const row = j * ns;
        const nextRow = (j + 1) * ns;
        const decided = (i * n + j) * ns;
        for (let s = 1; s < ns; s++) {
          const cond = condOf[s] ?? 0;
          const ms = lt[(cond === 0 ? at0 : cond === 1 ? at1 : at2) + j] ?? Infinity;
          const stay = last ? node.terminal : (self[nextRow + (nextOf[s] ?? NS_GREEN)] ?? Infinity);
          const boxBest = boxBestOf[s] ?? Infinity;
          const boxes = boxBest < stay;
          out[row + s] = ms + (boxes ? boxBest : stay);
          decisions[decided + s] = boxes ? (boxArgOf[s] ?? -1) : -1;
          if (i === 0) {
            solved.firstStay[s] = ms + stay;
            solved.firstBox[s] = ms + boxBest;
            solved.firstBoxArg[s] = boxArgOf[s] ?? -1;
          }
        }
        let green = 0;
        for (let g = 0; g < greens; g++) green += (greenWeights[g] ?? 0) * (out[row + (greenStates[g] ?? 0)] ?? Infinity);
        out[row + NS_GREEN] = green;
        if (neutral === null) continue;
        // an SC or VSC starting this lap, its length by its pmf: staying out and (where kept) boxing onto the best child
        const at = i * n + j;
        for (let k = 0; k < kinds.length; k++) {
          const entry = kinds[k];
          if (entry === undefined) continue;
          const target = neutral[entry.kind.key];
          const ms = lt[(entry.kind.cond === 1 ? at1 : at2) + j] ?? Infinity;
          if (last) {
            target.stay[at] = ms + node.terminal;
            continue;
          }
          target.stay[at] = ms + entry.after(self, nextRow);
          const arg = neutralArgOf[k] ?? -1;
          if (target.box === null || target.boxArg === null || arg < 0) continue;
          target.box[at] = ms + (neutralBoxOf[k] ?? Infinity);
          target.boxArg[at] = arg;
        }
      }
      if (i === 0) solved.first.set(out.subarray(0, ns));
      const jEntry = node.tyre === null ? i : 0;
      if (jEntry >= jFrom && jEntry <= jTo) solved.entry.set(out.subarray(jEntry * ns, (jEntry + 1) * ns), i * ns);
    }
    for (const w of works) [w.cur, w.next] = [w.next, w.cur];
  }
  return { nodes: works.map((w) => w.solved), lapTimes: tables, layout };
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
  let s = NS_NO_START;
  if (input.active !== null) s = layout.stateOf(input.active.condition, Math.max(0, input.active.remaining.findIndex((p) => p > 0)));
  const solved = nodeAt(graph, root);
  if (firstAction === 'free') return pathFrom(input, layout, graph, { index: root, i: 0, j: 0, s });
  const arg = firstAction === 'box' ? (solved.firstBoxArg[s] ?? -1) : -1;
  const at = afterLap(layout, s);
  const child = solved.node.children[arg];
  if (child === undefined) return pathFrom(input, layout, graph, { index: root, i: 1, j: 1, s: at });
  return [{ lap: input.fromLap, compound: child.compound }, ...pathFrom(input, layout, graph, { index: child.node, i: 1, j: 0, s: at })];
}

/** The state of the next lap's start on the path where no neutralisation comes. */
export const afterLap = (layout: Layout, s: number): number => {
  const next = layout.nextOf[s] ?? NS_GREEN;
  return next === NS_GREEN ? NS_NO_START : next;
};

/** A node's path from lap offset `i`, laps on its set `j`, state `s`, where no neutralisation comes: its stops. */
export function pathFrom(input: DpInput, layout: Layout, graph: GraphSolution, from: { index: number; i: number; j: number; s: number }): DpPlan['stops'] {
  const n = input.totalLaps - input.fromLap + 1;
  const stops: DpPlan['stops'] = [];
  let { index, j, s } = from;
  for (let i = from.i; i < n; i++) {
    const solved = nodeAt(graph, index);
    const arg = solved.decisions[(i * n + j) * layout.ns + s] ?? -1;
    s = afterLap(layout, s);
    const child = solved.node.children[arg];
    if (child !== undefined) {
      stops.push({ lap: input.fromLap + i, compound: child.compound });
      index = child.node;
      j = 0;
    } else j = solved.node.tyre === null ? i + 1 : j + 1;
  }
  return stops;
}

/** The feasible plans of a plan-graph solve, best first: per sequence root its expected time, its green path and its root. */
export function plansOf(input: DpInput, layout: Layout, graph: GraphSolution, roots: readonly number[]): (Play & { root: number })[] {
  const plans: (Play & { root: number })[] = [];
  for (const root of roots) {
    const expectedMs = valueAtStart(input, layout, nodeAt(graph, root), 'free');
    if (Number.isFinite(expectedMs)) plans.push({ stops: greenPath(input, layout, graph, root), expectedMs, root });
  }
  return plans.sort((a, b) => a.expectedMs - b.expectedMs);
}
