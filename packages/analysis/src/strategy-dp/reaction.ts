// `strategy-dp`'s reaction table (SP4.3d spec §5.2; C2, C43, C50): one world's solve read once into structured-cloneable
// typed arrays, queried by `race-monte-carlo`'s scenario play for our car's move when an SC or VSC starts. The DP owns
// "the best move for a state" (C43); the table only keeps its answers.
// - A query's `lap` is a race lap; `node` a node of the adaptive graph counted from its root (0 = the car's set at
//   `fromLap`); `tyreAge` the laps already run on the set at `lap`'s start (read only on a set fitted at a stop: on the
//   car's set the DP's own count since `fromLap` is used).
// - `reactAt`: the averaged move for an SC or VSC starting on `lap` (its length by the condition's duration pmf, never a
//   scenario's own): box onto the best compound where its value is below staying out's, else stay (a tie stays; no set
//   left, `MAX_STOPS` used or the last lap: stay).
// - `continueFrom`: the solve's path walk from `lap`'s start at a node and age where no neutralisation comes: its stops.
import { NOISE_COMPOUNDS, type NoiseCompound, type Policy } from '@pitwall/domain';
import type { DpSolution } from './solve.ts';
import { NS_NO_START, nodeAt } from './state.ts';

/** The most stops a node can make: one per compound. */
const K = NOISE_COMPOUNDS.length;

/** One world's reaction table: typed arrays indexed by node, lap offset `i` (0 = `fromLap`) and laps on the set `j`. */
export type ReactionTable = {
  fromLap: number;
  /** Laps from `fromLap` to the flag (`n`). */
  laps: number;
  /** How many adaptive nodes the table holds. */
  nodes: number;
  /** Per node 1 where its set is the car's set at `fromLap` (the root). */
  startSet: Uint8Array;
  /** Per `node * K + c` the compound index (`NOISE_COMPOUNDS`) of the node's c-th stop, −1 none. */
  childCompound: Int8Array;
  /** Per `node * K + c` the node after that stop. */
  childNode: Int16Array;
  /** Per `((cond * nodes + node) * n + i) * n + j` (cond 0 SC, 1 VSC) the averaged move: −1 stay, else the stop c. */
  react: Int8Array;
  /** Per `(node * n + i) * n + j` the stop at lap offset i's end where no neutralisation comes: −1 none, else c. */
  green: Int8Array;
};

/** The table of one world's solve (`solveWorld`): its adaptive graph's averaged SC/VSC moves and green decisions. */
export function reactionTable(s: DpSolution): ReactionTable {
  const { input, graph, adaptiveRoot } = s;
  const n = input.totalLaps - input.fromLap + 1;
  const nodes = graph.nodes.length - adaptiveRoot;
  const ns = graph.layout.ns;
  const startSet = new Uint8Array(nodes);
  const childCompound = new Int8Array(nodes * K).fill(-1);
  const childNode = new Int16Array(nodes * K).fill(-1);
  const react = new Int8Array(2 * nodes * n * n).fill(-1);
  const green = new Int8Array(nodes * n * n).fill(-1);
  for (let d = 0; d < nodes; d++) {
    const solved = nodeAt(graph, adaptiveRoot + d);
    startSet[d] = solved.node.tyre === null ? 1 : 0;
    solved.node.children.forEach((child, c) => {
      childCompound[d * K + c] = NOISE_COMPOUNDS.indexOf(child.compound);
      childNode[d * K + c] = child.node - adaptiveRoot;
    });
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const at = i * n + j;
        green[d * n * n + at] = solved.decisions[at * ns + NS_NO_START] ?? -1;
      }
    }
    const neutral = solved.neutral;
    if (neutral === null) continue;
    [neutral.sc, neutral.vsc].forEach((values, cond) => {
      const { stay, box, boxArg } = values;
      if (box === null || boxArg === null) return;
      const base = (cond * nodes + d) * n * n;
      for (let at = 0; at < n * n; at++) {
        const arg = boxArg[at] ?? -1;
        if (arg >= 0 && (box[at] ?? Infinity) < (stay[at] ?? Infinity)) react[base + at] = arg;
      }
    });
  }
  return { fromLap: input.fromLap, laps: n, nodes, startSet, childCompound, childNode, react, green };
}

/** The laps on the set the DP counts at lap offset `i`: on the car's set its laps since `fromLap`, else `tyreAge`. */
const ageOf = (t: ReactionTable, node: number, i: number, tyreAge: number): number => (t.startSet[node] === 1 ? i : tyreAge);

/** The averaged move for an SC or VSC starting on `lap` at `node` with `tyreAge` laps on the set (O(1)). */
export function reactAt(t: ReactionTable, q: { lap: number; node: number; tyreAge: number; condition: 'sc' | 'vsc' }): 'stay' | { box: NoiseCompound } {
  const n = t.laps;
  const i = q.lap - t.fromLap;
  if (i < 0 || i >= n || q.node < 0 || q.node >= t.nodes) return 'stay';
  const j = ageOf(t, q.node, i, q.tyreAge);
  if (j < 0 || j >= n) return 'stay';
  const cond = q.condition === 'sc' ? 0 : 1;
  const c = t.react[((cond * t.nodes + q.node) * n + i) * n + j] ?? -1;
  const compound = c < 0 ? undefined : NOISE_COMPOUNDS[t.childCompound[q.node * K + c] ?? -1];
  return compound === undefined ? 'stay' : { box: compound };
}

/** The stop `c` of `node` onto `compound`'s index, −1 none. */
function stopTo(t: ReactionTable, node: number, compound: number): number {
  for (let c = 0; c < K; c++) if (t.childCompound[node * K + c] === compound) return c;
  return -1;
}

/**
 * The node of `policy` at `lap`: after its stops from `fromLap` on before `lap` (a stop on lap L counts from L + 1), each
 * onto its compound; −1 where the table holds no such stop (no set left, `MAX_STOPS` used), so every query stays.
 */
export function nodeAlong(t: ReactionTable, policy: Policy, lap: number): number {
  let node = 0;
  for (const stop of policy.stops) {
    if (stop.lap >= lap) break;
    if (stop.lap < t.fromLap) continue;
    const c = stopTo(t, node, NOISE_COMPOUNDS.indexOf(stop.compound));
    if (c < 0) return -1;
    node = t.childNode[node * K + c] ?? -1;
  }
  return node;
}

/** The table's best play from `lap`'s start at `node` with `tyreAge` laps on the set where no neutralisation comes (O(laps)). */
export function continueFrom(t: ReactionTable, q: { lap: number; node: number; tyreAge: number }): Policy {
  const n = t.laps;
  const stops: Policy['stops'] = [];
  let node = q.node;
  if (node < 0 || node >= t.nodes) return { stops };
  const from = Math.max(0, q.lap - t.fromLap);
  let j = ageOf(t, node, from, q.tyreAge);
  for (let i = from; i < n; i++) {
    const c = j >= 0 && j < n ? (t.green[(node * n + i) * n + j] ?? -1) : -1;
    const compound = c < 0 ? undefined : NOISE_COMPOUNDS[t.childCompound[node * K + c] ?? -1];
    if (compound !== undefined) {
      stops.push({ lap: t.fromLap + i, compound });
      node = t.childNode[node * K + c] ?? 0;
      j = 0;
    } else j = t.startSet[node] === 1 ? i + 1 : j + 1;
  }
  return { stops };
}
