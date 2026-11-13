// `bestWith` (SP4.3b2 Task 5, spec §6, §9): a query of one solve's table, never a new solve. The best closed-loop play
// to the flag whose first stop is forced: the car stays out on its set up to the forced lap, over every neutralisation
// those laps may bring, then boxes at its end onto the forced compound (`'best'`: per state the child the table values
// best) or, for `noStopThrough`, plays free from the lap after it; the rest of the race is the table's values from
// there. With `under`, the start lap is neutralised by it with its laps left drawn from `remaining` (as `input.active`),
// so a stop at its end costs that condition's loss. Pure (C2); `null` where no such play keeps the rule and the sets (C3).
//
// The forced laps walk a few neutralisation states forward (any laps left); the table is read at the first lap the play
// is free, which must lie within the solved layout: `under.remaining` no longer than the hazard's duration pmf of its
// condition (or `input.active`'s) plus the forced laps. A longer one is a caller's bug.
import { COND_SC, COND_VSC, NS_GREEN, NS_NO_START, nodeAt, pathFrom, stopCostMs, type Layout, type SolvedNode } from './state.ts';
import type { DpSolution } from './solve.ts';
import type { DpFirst, DpInput, DpPlan, DpUnder } from './types.ts';

/** One part of the state distribution at a lap's start: green (a start possible), green with none, SC or VSC laps left. */
type Part = { kind: 'green' | 'noStart' | 'sc' | 'vsc'; left: number; p: number };

const condOf = (part: Part): number => (part.kind === 'sc' ? COND_SC : part.kind === 'vsc' ? COND_VSC : 0);

/** The part at the next lap's start. */
const next = (part: Part): Part => {
  if (part.kind === 'green' || part.kind === 'noStart') return { kind: 'green', left: 0, p: part.p };
  return part.left === 0 ? { kind: 'noStart', left: 0, p: part.p } : { kind: part.kind, left: part.left - 1, p: part.p };
};

/** The parts with the same state summed: at most one per state, so the walk stays as small as the layout. */
function merged(parts: readonly Part[]): Part[] {
  const byState = new Map<string, Part>();
  for (const part of parts) {
    const key = `${part.kind}${part.left}`;
    const seen = byState.get(key);
    if (seen === undefined) byState.set(key, { ...part });
    else seen.p += part.p;
  }
  return [...byState.values()];
}

/** The part at the next lap's start where no neutralisation comes (the green path). */
const pathNext = (part: Part): Part => ((part.kind === 'sc' || part.kind === 'vsc') && part.left > 0 ? next(part) : { kind: 'noStart', left: 0, p: part.p });

/** A part's state in the solved layout; one beyond it is a caller's bug (see the header). */
function stateOf(layout: Layout, part: Part): number {
  if (part.kind === 'green') return NS_GREEN;
  if (part.kind === 'noStart') return NS_NO_START;
  if (part.left >= layout.lengths[part.kind]) throw new Error(`strategy-dp: bestWith: ${part.kind} with ${part.left} laps left lies beyond the solved table`);
  return layout.stateOf(part.kind, part.left);
}

/** A green part at lap offset i split into its outcomes: no start, or an SC or VSC of each length. */
function expand(input: DpInput, parts: readonly Part[], i: number): Part[] {
  const { byLap, vscByLap, scDur, vscDur } = input.hazard;
  const out: Part[] = [];
  for (const part of parts) {
    if (part.kind !== 'green') {
      out.push(part);
      continue;
    }
    const pSc = byLap[i] ?? 0;
    const pVsc = vscByLap[i] ?? 0;
    if (1 - pSc - pVsc > 0) out.push({ kind: 'noStart', left: 0, p: part.p * (1 - pSc - pVsc) });
    scDur.forEach((p, k) => {
      if (pSc * p > 0) out.push({ kind: 'sc', left: k, p: part.p * pSc * p });
    });
    vscDur.forEach((p, k) => {
      if (pVsc * p > 0) out.push({ kind: 'vsc', left: k, p: part.p * pVsc * p });
    });
  }
  return out;
}

/** The state distribution at `fromLap`'s start: `under`'s (else `input.active`'s) laps left, else green. */
function startParts(input: DpInput, under: DpUnder | undefined): Part[] {
  const active = under ?? input.active;
  if (active === null) return [{ kind: 'green', left: 0, p: 1 }];
  const parts: Part[] = [];
  active.remaining.forEach((p, k) => {
    if (p > 0) parts.push({ kind: active.condition, left: k, p });
  });
  return parts;
}

/** The green path's part at `fromLap`'s start: the shortest laps left of a neutralisation out, else green with no start. */
function startPath(input: DpInput, under: DpUnder | undefined): Part {
  const active = under ?? input.active;
  if (active === null) return { kind: 'noStart', left: 0, p: 1 };
  return { kind: active.condition, left: Math.max(0, active.remaining.findIndex((p) => p > 0)), p: 1 };
}

/** The best child at lap offset i + 1 from `part` (its next state): its index, or −1 where every child is infinite. */
function bestChild(s: DpSolution, root: SolvedNode, part: Part, i: number): number {
  const { layout, graph } = s;
  const state = stateOf(layout, next(part));
  let arg = -1;
  let best = Infinity;
  root.node.children.forEach((child, c) => {
    const v = nodeAt(graph, child.node).entry[(i + 1) * layout.ns + state] ?? Infinity;
    if (v < best) {
      best = v;
      arg = c;
    }
  });
  return arg;
}

/**
 * The best plan to the flag whose first stop is `first` (at `stopLap` onto that compound, `'best'`: the DP picks; or
 * after `noStopThrough`), from the state "that neutralisation out at the start lap" with `under`; `null` when no such
 * plan keeps the compound rule and the sets.
 */
export function bestWith(s: DpSolution, first: DpFirst, under?: DpUnder): DpPlan | null {
  const { input, layout, graph } = s;
  const n = input.totalLaps - input.fromLap + 1;
  const root = nodeAt(graph, s.adaptiveRoot);
  const lt = graph.lapTimes.get(null);
  if (lt === undefined) throw new Error('strategy-dp: no lap times of the car’s set');
  const lapMs = (part: Part, i: number): number => lt[(condOf(part) * n + i) * n + i] ?? Infinity;

  const box = 'stopLap' in first;
  const forced = box ? first.stopLap - input.fromLap : Math.min(n, Math.max(0, first.noStopThrough - input.fromLap + 1));
  if (box && (forced < 0 || forced >= n - 1)) return null;
  const childArg = box && first.compound !== 'best' ? root.node.children.findIndex((c) => c.compound === first.compound) : -1;
  if (box && first.compound !== 'best' && childArg < 0) return null;

  // the laps on the car's set before the first free action
  let parts = startParts(input, under);
  let path = startPath(input, under);
  let ms = 0;
  for (let i = 0; i < forced; i++) {
    parts = expand(input, parts, i);
    for (const part of parts) ms += part.p * lapMs(part, i);
    parts = merged(parts.map(next));
    path = pathNext(path);
  }

  if (!box) {
    if (forced >= n) ms += root.node.terminal;
    else for (const part of parts) ms += part.p * (root.entry[forced * layout.ns + stateOf(layout, part)] ?? Infinity);
    if (!Number.isFinite(ms)) return null;
    return { stops: pathFrom(input, layout, graph, { index: s.adaptiveRoot, i: forced, j: forced, s: stateOf(layout, path) }), expectedMs: ms };
  }

  // the forced stop at the end of lap offset `forced`, then the table's values from the next lap
  const i = forced;
  for (const part of expand(input, parts, i)) {
    const arg = childArg >= 0 ? childArg : bestChild(s, root, part, i);
    const child = root.node.children[arg];
    const after = child === undefined ? Infinity : (nodeAt(graph, child.node).entry[(i + 1) * layout.ns + stateOf(layout, next(part))] ?? Infinity);
    ms += part.p * (lapMs(part, i) + stopCostMs(input, condOf(part), i) + after);
  }
  if (!Number.isFinite(ms)) return null;
  const child = root.node.children[childArg >= 0 ? childArg : bestChild(s, root, path, i)];
  if (child === undefined) return null;
  const rest = pathFrom(input, layout, graph, { index: child.node, i: i + 1, j: 0, s: stateOf(layout, pathNext(path)) });
  return { stops: [{ lap: input.fromLap + i, compound: child.compound }, ...rest], expectedMs: ms };
}
