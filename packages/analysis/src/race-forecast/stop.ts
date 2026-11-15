// `race-forecast`'s one stop-and-rejoin model (SP4.3c Task 17, O8, B8; C43, C50): what a stop costs a car and where
// it rejoins. The forecast's stops, the DP's stop cost and traffic, and `rejoin`'s positions all read it; no other unit
// prices a stop from the raw loss. Pure (C2).
//
// - The cost of a stop under a condition is that condition's whole loss (the in-lap share and the out-lap rest
//   together), less a human's shorter stationary time.
// - A stopper's rejoin time T at the line is its time there plus the cost. It rejoins behind every running car crossing
//   before T, and yields once to the first car that stayed out crossing in [T, T + minGapMs) (the pit-exit yield, SP4.3b
//   Task 11h): it rejoins `minGapMs` behind that car. A retired car is nobody's neighbour.
import type { StartingPoint } from '@pitwall/domain';
import { HUMAN_STOP_SAVING_MS } from './constants.ts';

/** The condition a stop is made under. */
export type StopCondition = 'green' | 'vsc' | 'sc';

/** The pit losses a stop is priced from: per condition (ms) and the in-lap's share. */
export type StopLosses = StartingPoint['track']['pitLossMs'];

/** The whole time a stop with loss `lossMs` costs: the loss, less a human's shorter stationary time (the model's core). */
export const stopCostOfLoss = (lossMs: number, human: boolean): number => lossMs - (human ? HUMAN_STOP_SAVING_MS : 0);

/** The whole time a stop costs under `condition`. */
export const stopCostOf = (losses: StopLosses, human: boolean, condition: StopCondition): number => stopCostOfLoss(losses[condition], human);

/** The whole time a stop costs car `car` of `start` under `condition`. */
export const stopCostMs = (start: StartingPoint, car: number, condition: StopCondition): number => stopCostOf(start.track.pitLossMs, start.human[car] === 1, condition);

/** The in-lap's part of a stop's loss under `condition`: `inLapShare` of it, paid before the line (F2). */
export const inLapCostMs = (losses: StopLosses, condition: StopCondition): number => losses.inLapShare * losses[condition];

/**
 * The pit-exit yield of a rejoin time `t`: the first time of `count` others' (`timeOf(k)`, `undefined` for a car that
 * takes no part) in [t, t + minGapMs) plus `minGapMs`, else `t`. Once, against the times before any yield.
 */
export function yieldedRejoinMs(t: number, count: number, timeOf: (k: number) => number | undefined, minGapMs: number): number {
  let first = Infinity;
  for (let k = 0; k < count; k++) {
    const to = timeOf(k);
    if (to !== undefined && to >= t && to < t + minGapMs && to < first) first = to;
  }
  return first === Infinity ? t : first + minGapMs;
}

/** The road at a line: per car slot its time there on one axis (any reference; ±Infinity a car laps ahead or behind) and whether it is retired (1). */
export type RoadAtLine = { timeMs: ArrayLike<number>; retired: ArrayLike<number> };

/** Where a stopper rejoins: its race position and its gaps to the cars ahead of and behind it on the road (Infinity: none). */
export type StopperRejoin = { position: number; gapAheadMs: number; gapBehindMs: number };

/** Car `car`'s rejoin on `road` stopping for `costMs` (the model's core): its rejoin time on the road's axis too. */
export function rejoinOnRoad(road: RoadAtLine, car: number, costMs: number, minGapMs: number): StopperRejoin & { rejoinMs: number } {
  const n = road.timeMs.length;
  const runs = (k: number): boolean => k !== car && road.retired[k] !== 1;
  const t = (road.timeMs[car] ?? 0) + costMs;
  const rejoinMs = yieldedRejoinMs(t, n, (k) => (runs(k) ? (road.timeMs[k] ?? 0) : undefined), minGapMs);
  let ahead = 0;
  let nearestAhead = -Infinity;
  let nearestBehind = Infinity;
  for (let k = 0; k < n; k++) {
    if (!runs(k)) continue;
    const to = road.timeMs[k] ?? 0;
    if (to < rejoinMs) {
      ahead++;
      if (to > nearestAhead) nearestAhead = to;
    } else if (to < nearestBehind) nearestBehind = to;
  }
  return { position: ahead + 1, gapAheadMs: rejoinMs - nearestAhead, gapBehindMs: nearestBehind - rejoinMs, rejoinMs };
}

/**
 * Where car `car` of `start` rejoins when it stops under `condition` at the end of its start lap (`startLapOf`): the
 * starting point's gaps are the road. `atLap`, when given, must be that lap: a later lap needs a projection of the road
 * nobody owns (SP4.3c R52).
 */
export function stopperRejoin(start: StartingPoint, car: number, condition: StopCondition, atLap?: number): StopperRejoin {
  if (atLap !== undefined && atLap !== startLapOf(start, car)) throw new Error(`stopperRejoin: car ${car} at lap ${atLap}, not its start lap`);
  const { position, gapAheadMs, gapBehindMs } = rejoinOnRoad({ timeMs: start.gapMs, retired: start.retired }, car, stopCostMs(start, car, condition), start.interaction.minGapMs);
  return { position, gapAheadMs, gapBehindMs };
}

/**
 * The lap car `c` is on at the start: the leader's lap `start.lap`, or the one before for a car past the leader's lap
 * fraction (behind it, not yet at the line). The forecast's one rule; `forecast-score`'s policies read it too.
 */
export function startLapOf(start: StartingPoint, c: number): number {
  const leader = start.order.find((k) => start.retired[k] !== 1);
  const leaderFraction = leader === undefined ? 0 : (start.lapFraction[leader] ?? 0);
  return (start.lapFraction[c] ?? 0) > leaderFraction ? start.lap - 1 : start.lap;
}
