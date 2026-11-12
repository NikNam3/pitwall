// `strategy-dp`'s trigger thresholds (SP4.3b spec §6, O9), read from one solve: SC/VSC per remaining stop, damage,
// degradation off (by bisection over a few re-solves) and rain. A simulator has no view and so no `config.ts` (C47
// binds calculators and analyses); the constants are the model's fixed terms, each with its source.
import { NOISE_COMPOUNDS, type LapInput, type NoiseCompound, type Trigger } from '@pitwall/domain';
import { lapTimeMs } from '../lap-model/index.ts';
import { HUMAN_STOP_SAVING_MS } from '../race-forecast/constants.ts';
import { DRY_COMPOUNDS, nodeAt, type GraphSolution } from './state.ts';
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

/** What the thresholds read of a solve. */
export type ThresholdInput = {
  input: DpInput;
  /** The solve holding the adaptive graph, and its root. */
  graph: GraphSolution;
  adaptiveRoot: number;
  /** The best play: the best plan, else the stay-out play. */
  best: DpPlan;
  boxNow: DpPlan | null;
  stayOut: DpPlan;
  /** Re-solves the plans of a changed input and gives the best one, or `null` where none is feasible. */
  bestPlanOf: (input: DpInput) => DpPlan | null;
};

/** The adaptive nodes along `stops` from `root`: `[k]` is the node after the first k stops. */
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
 * Per remaining stop of the best play (and one more where a set is left) the lap ranges where boxing under an SC or
 * VSC starting that lap beats staying out past it (S25), split where the best compound changes.
 */
function neutralised(t: ThresholdInput): Trigger[] {
  const { input } = t;
  const n = input.totalLaps - input.fromLap + 1;
  const out: Trigger[] = [];
  nodesAlong(t.graph, t.adaptiveRoot, t.best.stops).forEach((index, k) => {
    const solved = nodeAt(t.graph, index);
    if (solved.neutral === null || solved.node.children.length === 0) return;
    const previousStop = k === 0 ? undefined : t.best.stops[k - 1];
    const previous = previousStop === undefined ? null : previousStop.lap - input.fromLap;
    for (const condition of ['sc', 'vsc'] as const) {
      const { box, boxArg, stay } = solved.neutral[condition];
      let run: { from: number; to: number; compound: NoiseCompound } | null = null;
      const flush = (): void => {
        if (run !== null) out.push({ kind: 'neutralised', condition, fromLap: input.fromLap + run.from, toLap: input.fromLap + run.to, action: { box: run.compound } });
        run = null;
      };
      for (let i = previous === null ? 0 : previous + 1; i < n - 1; i++) {
        const at = i * n + (previous === null ? i : i - previous - 1);
        const compound = solved.node.children[boxArg[at] ?? -1]?.compound;
        if (compound === undefined || !((box[at] ?? Infinity) < (stay[at] ?? Infinity))) {
          flush();
          continue;
        }
        if (run !== null && run.compound === compound) run.to = i;
        else {
          flush();
          run = { from: i, to: i, compound };
        }
      }
      flush();
    }
  });
  return out;
}

/** The loss per lap on the car's set above which boxing now beats carrying it to the stay-out play's next stop. */
function damage(t: ThresholdInput): Trigger[] {
  const { input, boxNow, stayOut } = t;
  const compound = boxNow?.stops[0]?.compound;
  if (boxNow === null || compound === undefined || !Number.isFinite(stayOut.expectedMs)) return [];
  const laps = (stayOut.stops[0]?.lap ?? input.totalLaps) - input.fromLap;
  if (laps <= 0) return [];
  return [{ kind: 'damage', lossMsPerLap: Math.max(0, boxNow.expectedMs - stayOut.expectedMs) / laps, action: { box: compound } }];
}

const sequenceKey = (plan: DpPlan | null): string | null => (plan === null ? null : plan.stops.map((s) => s.compound).join('-'));

/** The wear-rate increase (percentage points per lap on every compound) at which the best sequence changes, by bisection. */
function degradationOff(t: ThresholdInput): Trigger[] {
  const { input } = t;
  const rates = input.carParams.wearRatePct;
  if (rates === null) return [];
  const top = rates[input.carParams.compound] * DEG_OFF_MAX_FACTOR;
  if (!(top > 0)) return [];
  const base = sequenceKey(t.best);
  const at = (delta: number): DpPlan | null => {
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
 * The track wetness (ms) above which switching a slick-shod car to a wet-weather set at the end of `fromLap` beats
 * staying out on its set to the flag, pit loss included (the lap model's wetness term, green laps).
 */
function rain(t: ThresholdInput): Trigger[] {
  const { input } = t;
  const p = input.carParams;
  const n = input.totalLaps - input.fromLap + 1;
  const to = RAIN_SETS.find((c) => input.sets[c] > 0);
  if (!DRY_COMPOUNDS.includes(p.compound) || to === undefined || n < 2) return [];
  const burn = p.fuelKg / n;
  const rate = (c: NoiseCompound): number => p.wearRatePct?.[c] ?? 0;
  const lap: LapInput = { paceMs: p.paceMs, degMsPerLap: p.degMsPerLap, wearPct: 0, fuelKg: 0, compound: p.compound, lapOnSet: 1, neutralised: 'none', wetnessMs: 0, scatterMs: 0, mistakeMs: 0 };
  // the switch's gain over the laps after `fromLap` at a constant wetness w, less the stop: linear in w for w > 0
  const gain = (w: number): number => {
    let g = -(input.pitLossMs.green - (p.human ? HUMAN_STOP_SAVING_MS : 0) + (input.trafficMsByLap[0] ?? 0));
    let fuel = p.fuelKg;
    for (let i = 1; i < n; i++) {
      fuel = Math.max(0, fuel - burn);
      Object.assign(lap, { wetnessMs: w, fuelKg: fuel, compound: p.compound, wearPct: p.wearPct + rate(p.compound) * i, lapOnSet: p.tyreAge + i + 1 });
      const stay = lapTimeMs(input.lap, lap);
      Object.assign(lap, { compound: to, wearPct: rate(to) * (i - 1), lapOnSet: i });
      g += stay - lapTimeMs(input.lap, lap);
    }
    return g;
  };
  const g1 = gain(1);
  const slope = gain(2) - g1;
  if (!(slope > 0)) return [];
  return [{ kind: 'rain', wetnessMs: Math.max(0, 1 - g1 / slope), action: { box: to } }];
}

/** Every trigger threshold of a solve (spec §6, O9). */
export function thresholdsOf(t: ThresholdInput): Trigger[] {
  return [...neutralised(t), ...damage(t), ...degradationOff(t), ...rain(t)];
}
