// Starting points that carry `rival-stops`' plan of each rival (SP4.3c Task 18, O9, O5), for the rival plain policy's
// tests. The test agent's reading of the plan's interface (`rivalPlainPolicy(start, k, weather)`: "the stop lap from
// rival-stops' window, the compound from its odds, the switch from switchLap"): the starting point carries, per car
// slot, rival-stops' next-compound odds and its tyre-type switch beside the window it already carries
// (`stopLow`/`stopMid`/`stopHigh`, `owesStop`). Proposed `StartingPoint` fields (a supervisor change, C78; see the
// task report), each indexed by car slot:
// - `nextOdds[k]`: rival-stops' `nextCompound` odds (sum 1); `null` where they are unknown;
// - `typeSwitch[k]`: rival-stops' `switchLap` and `switchTo` (`{ lap, to }`); `null` where the switch is unknown.
// `forecast-field` fills them from `rival-stops` as it fills the window; `startOfStops` maps a `RivalStops` the same
// way here (forecast-field's rule, `shared/forecast-field/index.ts`: no entry → no stop before the flag; an unknown
// window → from the next lap to the flag; an unknown `owesStop` → the config's assumption).
import { type CarId, type NoiseCompound, type RivalStops, type StartingPoint, type TyreType } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { FORECAST_FIELD_CONFIG } from '../../src/shared/forecast-field/config.ts';

/** The fields a starting point carries for the rival plain policy (proposed, see above). */
export type RivalPlanFields = {
  nextOdds: (Partial<Record<NoiseCompound, number>> | null)[];
  typeSwitch: ({ lap: number; to: TyreType } | null)[];
};

/** A starting point with the rivals' plans. */
export type PlannedStart = StartingPoint & RivalPlanFields;

/** One rival's plan as a test gives it: its window (low, mid, high), whether it owes a stop, its odds and its switch. */
export type RivalPlanSpec = {
  window?: [low: number, mid: number, high: number];
  owesStop?: boolean;
  odds?: Partial<Record<NoiseCompound, number>>;
  switchAt?: { lap: number; to: TyreType };
};

/** `start` with the plans of `plans` by car slot; a slot not given keeps its window and has no odds and no switch. */
export function withRivalPlans(start: StartingPoint, plans: Record<number, RivalPlanSpec>): PlannedStart {
  const nextOdds: RivalPlanFields['nextOdds'] = Array.from({ length: start.cars }, () => null);
  const typeSwitch: RivalPlanFields['typeSwitch'] = Array.from({ length: start.cars }, () => null);
  const out: PlannedStart = { ...start, stopLow: start.stopLow.slice(), stopMid: start.stopMid.slice(), stopHigh: start.stopHigh.slice(), owesStop: start.owesStop.slice(), nextOdds, typeSwitch };
  for (const [slot, plan] of Object.entries(plans)) {
    const k = Number(slot);
    if (plan.window !== undefined) [out.stopLow[k], out.stopMid[k], out.stopHigh[k]] = plan.window;
    if (plan.owesStop !== undefined) out.owesStop[k] = plan.owesStop ? 1 : 0;
    nextOdds[k] = plan.odds ?? null;
    typeSwitch[k] = plan.switchAt ?? null;
  }
  return out;
}

/** `start` with `stops` mapped onto it as `forecast-field` maps `rival-stops`' output (its window, owesStop, odds, switch). */
export function startOfStops(start: StartingPoint, stops: DeepReadonly<RivalStops>): PlannedStart {
  const plans: Record<number, RivalPlanSpec> = {};
  const total = start.lapsTotal;
  for (let k = 0; k < start.cars; k++) {
    const stop = stops[k as CarId];
    if (stop === undefined) {
      plans[k] = { window: [total, total, total], owesStop: false };
      continue;
    }
    const low = Math.min(start.lap + 1, total);
    const window: [number, number, number] = stop.window.known
      ? [stop.window.value.lowLap, stop.window.value.midLap, stop.window.value.highLap]
      : [low, Math.floor((low + total) / 2), total];
    plans[k] = {
      window,
      owesStop: stop.owesStop.known ? stop.owesStop.value : FORECAST_FIELD_CONFIG.defaults.assumeOwesStop,
      ...(stop.nextCompound.known && { odds: { ...stop.nextCompound.value } }),
      ...(stop.switchLap.known && stop.switchTo.known && { switchAt: { lap: stop.switchLap.value, to: stop.switchTo.value } }),
    };
  }
  return withRivalPlans(start, plans);
}
