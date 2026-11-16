// `strategy-dp`'s trigger thresholds (SP4.3b spec §6, O9; SP4.3c spec §5.4: each plan its own), read from one world's
// solve: per plan its SC/VSC ranges along its own sequence; for the world's best plan also damage, degradation off (by
// bisection over a few re-solves) and rain. The constants are the model's fixed terms, each with its source.
import { NOISE_COMPOUNDS, type LapInput, type NoiseCompound, type Trigger } from '@pitwall/domain';
import { lapTimeMs } from '../lap-model/index.ts';
import { stopCostOf } from '../race-forecast/stop.ts';
import { isWet } from '../track-wetness/wet.ts';
import { after, DRY_COMPOUNDS, neutralKindsOf, nodeAt, stopCostMs, worldOf, type GraphSolution, type Play } from './state.ts';
import type { DpInput, DpPlan } from './types.ts';

/** The degradation-off threshold's bisection steps, each a re-solve (spec §6, plan 4.3b1 Task 18: `degBisectSteps` 4). */
export const DEG_BISECT_STEPS = 4;
/**
 * The degradation-off search's bracket: up to this factor of the car's compound's wear rate added to every rate, so
 * wear up to twice the model's (pitwall estimate: a degradation off by more is a different car, not a threshold).
 */
export const DEG_OFF_MAX_FACTOR = 1;

/** The wet-weather sets a slick-shod car switches to in rain, in order (spec §6: inters and wets join in a wet race). */
const RAIN_SETS: readonly NoiseCompound[] = ['inter', 'wet'];

/** The nodes along `stops` from `root`: `[k]` is the node after the first k stops. */
export function nodesAlong(graph: GraphSolution, root: number, stops: DpPlan['stops']): number[] {
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

/**
 * A play's own `neutralised` triggers (S25, SP4.3c §5.4): per stop k of its stops, from the lap after stop k − 1, the
 * lap ranges where boxing onto stop k's compound under an SC or VSC starting that lap beats staying out past it, along
 * the play's path from `root` in `graph`. A play without a stop has none.
 */
export function neutralisedOf(input: DpInput, graph: GraphSolution, root: number, stops: DpPlan['stops']): Trigger[] {
  const n = input.totalLaps - input.fromLap + 1;
  const { layout } = graph;
  const kinds = neutralKindsOf(input, layout);
  const along = nodesAlong(graph, root, stops);
  const out: Trigger[] = [];
  stops.forEach((stop, k) => {
    const index = along[k];
    if (index === undefined) return;
    const solved = nodeAt(graph, index);
    const child = solved.node.children.find((c) => c.compound === stop.compound);
    const lt = graph.lapTimes.get(solved.node.tyre);
    const { neutral } = solved;
    if (child === undefined || lt === undefined || neutral === null) return;
    const kid = nodeAt(graph, child.node);
    const previousStop = k === 0 ? undefined : stops[k - 1];
    const previous = previousStop === undefined ? null : previousStop.lap - input.fromLap;
    for (const kind of kinds) {
      const { stay } = neutral[kind.key];
      let run: { from: number; to: number } | null = null;
      const flush = (): void => {
        if (run !== null) out.push({ kind: 'neutralised', condition: kind.key, fromLap: input.fromLap + run.from, toLap: input.fromLap + run.to, action: { box: stop.compound } });
        run = null;
      };
      for (let i = previous === null ? 0 : previous + 1; i < n - 1; i++) {
        const j = previous === null ? i : i - previous - 1;
        const box = (lt[(kind.cond * n + i) * n + j] ?? Infinity) + stopCostMs(input, kind.cond, i) + after(kind, kid.entry, (i + 1) * layout.ns);
        if (!(box < (stay[i * n + j] ?? Infinity))) {
          flush();
          continue;
        }
        if (run === null) run = { from: i, to: i };
        else run.to = i;
      }
      flush();
    }
  });
  return out;
}

/** What the best plan's further thresholds read of a solve. */
export type ThresholdInput = {
  input: DpInput;
  /** The world's best plan, else the continue play. */
  best: Play;
  boxThisLap: Play | null;
  continue: Play;
  /** Re-solves the plans of a changed input and gives the best one, or `null` where none is feasible. */
  bestPlanOf: (input: DpInput) => Play | null;
};

/** The loss per lap on the car's set above which boxing now beats carrying it to the continue play's next stop. */
function damage(t: ThresholdInput): Trigger[] {
  const { input, boxThisLap, continue: stay } = t;
  const compound = boxThisLap?.stops[0]?.compound;
  if (boxThisLap === null || compound === undefined || !Number.isFinite(stay.expectedMs)) return [];
  const laps = (stay.stops[0]?.lap ?? input.totalLaps) - input.fromLap;
  if (laps <= 0) return [];
  return [{ kind: 'damage', lossMsPerLap: Math.max(0, boxThisLap.expectedMs - stay.expectedMs) / laps, action: { box: compound } }];
}

const sequenceKey = (plan: Play | null): string | null => (plan === null ? null : plan.stops.map((s) => s.compound).join('-'));

/** The wear-rate increase (percentage points per lap on every compound) at which the best sequence changes, by bisection. */
function degradationOff(t: ThresholdInput): Trigger[] {
  const { input } = t;
  const rates = input.carParams.wearRatePct;
  if (rates === null) return [];
  const top = rates[input.carParams.compound] * DEG_OFF_MAX_FACTOR;
  if (!(top > 0)) return [];
  const base = sequenceKey(t.best);
  const at = (delta: number): Play | null => {
    const shifted = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, rates[c] + delta])) as Record<NoiseCompound, number>;
    return t.bestPlanOf({ ...input, carParams: { ...input.carParams, wearRatePct: shifted } });
  };
  let switchTo = at(top);
  if (switchTo === null || sequenceKey(switchTo) === base) return [];
  let lo = 0;
  let hi = top;
  for (let step = 0; step < DEG_BISECT_STEPS; step++) {
    const mid = (lo + hi) / 2;
    const plan = at(mid);
    if (plan !== null && sequenceKey(plan) !== base) {
      hi = mid;
      switchTo = plan;
    } else lo = mid;
  }
  return [{ kind: 'degradationOff', wearRateDeltaPct: hi, action: { switchTo: switchTo.stops } }];
}

/**
 * The rain threshold's refinements of the best dry plan: each re-solves the dry plans at the last crossing and stops
 * once the best one no longer changes (pitwall estimate: the best dry plan changes a few times at most over the
 * wetness range a switch to inters is decided on).
 */
export const RAIN_REFINE_STEPS = 4;
/** The two positive wetnesses (ms) a fixed plan's linear race time is read at: past the cold tyre's wet step at 0. */
const RAIN_PROBE_MS = [1_000, 2_000] as const;

/** The deterministic green race time (ms) from `fromLap` to the flag at a constant wetness `w` with `stops`, each stint on its compound's terms. */
function greenRaceMs(input: DpInput, w: number, stops: DpPlan['stops']): number {
  const p = input.carParams;
  const n = input.totalLaps - input.fromLap + 1;
  const traffic = worldOf(input).trafficMsByLap;
  // the car's burn per lap (the starting point's, O15)
  const burn = p.fuelBurnKgPerLap;
  const lap: LapInput = { paceMs: p.paceMs, degMsPerLap: p.degMsPerLap[p.compound], wearPct: p.wearPct, fuelKg: p.fuelKg, compound: p.compound, lapOnSet: 1, neutralised: 'none', wetnessMs: w, wet: isWet(w, 0, 0), scatterMs: 0, mistakeMs: 0 };
  let onSet = p.tyreAge;
  let total = 0;
  for (let i = 0; i < n; i++) {
    lap.lapOnSet = onSet + 1;
    total += lapTimeMs(input.lap, lap);
    onSet++;
    lap.wearPct += p.wearRatePct?.[lap.compound] ?? 0;
    lap.fuelKg = Math.max(0, lap.fuelKg - burn);
    const stop = stops.find((s) => s.lap === input.fromLap + i);
    if (stop !== undefined) {
      total += stopCostOf(input.pitLossMs, p.human, 'green') + (traffic[i] ?? 0);
      Object.assign(lap, { compound: stop.compound, degMsPerLap: p.degMsPerLap[stop.compound], wearPct: 0 });
      onSet = 0;
    }
  }
  return total;
}

const stopsKey = (stops: DpPlan['stops']): string => stops.map((s) => `${s.lap}${s.compound}`).join('-');

/**
 * The track wetness (ms, constant on every lap) above which switching a slick-shod car to its first wet-weather set at
 * the end of `fromLap`, run to the flag, beats the best dry plan (stops onto dry compounds only) at that wetness, pit
 * loss included (green laps, no hazard). None where it is at or below the world's current wetness (`wetnessByLap[0]`).
 */
function rain(t: ThresholdInput): Trigger[] {
  const { input } = t;
  const p = input.carParams;
  const n = input.totalLaps - input.fromLap + 1;
  const to = RAIN_SETS.find((c) => input.sets[c] > 0);
  if (!DRY_COMPOUNDS.includes(p.compound) || to === undefined || n < 2) return [];
  const switched: DpPlan['stops'] = [{ lap: input.fromLap, compound: to }];
  const zeros = new Float64Array(n);
  const world = worldOf(input);
  const dryInput = (w: number): DpInput => ({
    ...input,
    sets: { ...input.sets, inter: 0, wet: 0 },
    hazard: { ...input.hazard, byLap: zeros, vscByLap: zeros },
    active: null,
    worlds: [{ ...world, wetnessByLap: new Float64Array(n).fill(w) }],
  });
  // the best dry plan at w; where the rule cannot be met on dry sets, staying out
  const bestDry = (w: number): DpPlan['stops'] => t.bestPlanOf(dryInput(w))?.stops ?? [];
  // switched minus the dry plan: linear in w > 0 for a fixed plan; its zero
  const crossing = (dry: DpPlan['stops']): number | null => {
    const [a, b] = RAIN_PROBE_MS.map((w) => greenRaceMs(input, w, switched) - greenRaceMs(input, w, dry)) as [number, number];
    const slope = (b - a) / (RAIN_PROBE_MS[1] - RAIN_PROBE_MS[0]);
    return slope < 0 ? RAIN_PROBE_MS[0] - a / slope : null;
  };
  const current = world.wetnessByLap[0] ?? 0;
  let dry = bestDry(current);
  let w = crossing(dry);
  for (let step = 0; step < RAIN_REFINE_STEPS && w !== null; step++) {
    const next = bestDry(w);
    if (stopsKey(next) === stopsKey(dry)) break;
    dry = next;
    w = crossing(dry);
  }
  if (w === null || !(w > current)) return [];
  return [{ kind: 'rain', wetnessMs: w, action: { box: to } }];
}

/**
 * The world's best plan's thresholds besides its neutralised ones (spec §6, O9): damage, degradation off and rain. A plan
 * without a stop gets no box trigger (damage, rain), only degradation off.
 */
export function bestPlanThresholds(t: ThresholdInput): Trigger[] {
  const boxes = t.best.stops.length > 0;
  return [...(boxes ? damage(t) : []), ...degradationOff(t), ...(boxes ? rain(t) : [])];
}
