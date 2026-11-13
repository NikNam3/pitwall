// `undercut`'s cases (SP4.3b spec §9.1; C43): per rival and N = 1 … `maxLapsLater`, the candidate `scoreCalls` scores
// (rival ahead: we box now, it N laps later on its next compound; rival behind: the mirror), until both have stopped
// plus one lap; and a case's value from its per-scenario outcomes. Pure (C2).
import { known, unknown, UNDERCUT_GAIN_BINS, type Known, type Ms, type Policy, type StartingPoint, type Trigger, type UndercutCase } from '@pitwall/domain';
import { hasStopAhead, rivalNextCompound, type CallCandidate, type CallOutcome } from '../race-monte-carlo/index.ts';
import { binShares } from '../shared/distribution.ts';
import { policyOf } from '../shared/strategy-input/index.ts';
import { bestWith, type DpSolution } from '../strategy-dp/index.ts';
import type { UndercutRivalInput } from './prepare.ts';

/** One case to score: its rival, N and the candidate. */
export type CaseCall = { rival: UndercutRivalInput; n: UndercutCase['n']; candidate: CallCandidate };

/** A rival's stops when it boxes at the end of `lap`; `null`: it makes no such stop. */
export type RivalStopsAt = (lap: number) => Policy['stops'] | null;

/**
 * A rival's stops from the starting point (precondition 5): one stop on its next compound, none for a rival with no stop
 * still ahead or without a next compound.
 */
export function rivalStopsOf(start: StartingPoint, k: number): RivalStopsAt {
  const next = hasStopAhead(start, k) ? rivalNextCompound(start, k) : null;
  return (lap) => (next === null ? null : [{ lap, compound: next }]);
}

/** Our other car's stops as its own DP plays them with its first stop at `lap` (C43); `null` where it has no such plan. */
export function ownStopsOf(sol: DpSolution): RivalStopsAt {
  return (lap) => bestWith(sol, { stopLap: lap, compound: 'best' })?.stops.map((s) => ({ lap: s.lap, compound: s.compound })) ?? null;
}

/**
 * The cases of our car against `rival` from our stop lap `lap` (spec §9.1), our plans from our DP solution `sol`: none
 * for an N whose gap lap (the later stop's out-lap done) is past the last lap, where the DP has no plan with our stop on
 * that lap (`bestWith` `null`: no set left), or where the rival makes no stop there (`stopsAt`).
 */
export function casesOf(start: StartingPoint, sol: DpSolution, thresholds: readonly Trigger[], lap: number, rival: UndercutRivalInput, stopsAt: RivalStopsAt, maxLapsLater: number): CaseCall[] {
  const out: CaseCall[] = [];
  for (let n = 1; n <= Math.min(3, maxLapsLater); n++) {
    const later = lap + n;
    const gapAtLap = later + 1;
    if (gapAtLap > start.lapsTotal) continue;
    const ahead = rival.side === 'ahead';
    const stops = stopsAt(ahead ? later : lap);
    if (stops === null) continue;
    const plan = bestWith(sol, { stopLap: ahead ? lap : later, compound: 'best' });
    if (plan === null) continue;
    out.push({
      rival,
      n: n as UndercutCase['n'],
      candidate: { policy: policyOf(plan, thresholds), rival: { carId: rival.carId, policy: { stops, triggers: [] }, gapAtLap }, untilLap: gapAtLap },
    });
  }
  return out;
}

/** The lower median of `values`. */
function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

/**
 * A case's value from its outcomes (spec §9.1): the mean gap change in our favour, the share ending ahead and the gain
 * bins over the scenarios where both cars ran at the gap lap; the rejoin position `rejoin`'s green one when we box now
 * (C43), else the simulated rejoin's median. Without a scenario: `unknown('insufficientData')` (C3).
 */
export function caseValue(call: CaseCall, outcome: CallOutcome | undefined, greenRejoin: Known<number>, at: Ms): UndercutCase {
  const none = unknown('insufficientData');
  const gains: number[] = [];
  let ahead = 0;
  for (const g of outcome?.gapMs ?? []) {
    if (!Number.isFinite(g)) continue;
    gains.push(g - call.rival.signedGapMs);
    if (g > 0) ahead++;
  }
  const boxNow = call.rival.side === 'ahead';
  const rejoins = Array.from(outcome?.rejoin ?? []).filter((p) => p > 0);
  const rejoinPosition: Known<number> = boxNow ? greenRejoin : rejoins.length === 0 ? none : known(lowerMedian(rejoins), at);
  if (gains.length === 0) return { n: call.n, gainMs: none, pAhead: none, gainBins: none, rejoinPosition };
  const bins = { from: UNDERCUT_GAIN_BINS.fromMs, step: UNDERCUT_GAIN_BINS.stepMs, count: UNDERCUT_GAIN_BINS.count };
  return {
    n: call.n,
    gainMs: known(gains.reduce((a, b) => a + b, 0) / gains.length, at),
    pAhead: known(ahead / gains.length, at),
    gainBins: known(binShares(Float64Array.from(gains), bins), at),
    rejoinPosition,
  };
}
