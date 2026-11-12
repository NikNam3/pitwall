// Value types of the `strategy` analysis (SP4.3b spec §7.4, §8.1): per our car the candidate policies `race-monte-carlo`
// ranked, and the run's metadata. JSON-safe: the topic `strategy.plans` publishes it as a job's result (C51).
import type { Policy, Trigger } from '../forecast.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';

/** Where a candidate policy came from: the DP, a stop-lap neighbour of a DP plan, a rule candidate, the committed plan. */
export type McSource = 'dp' | 'neighbour' | 'rule' | 'committed';

/**
 * One ranked policy (spec §7.4): the finishing-position pmf (P1 … Pn), E[position], E[points], the mean race time,
 * position quantiles, the chance to gain a place at the finish; per trigger how often it fired and what it was worth in
 * places; its paired difference and SE against the leader and whether it ties; whether it is the committed plan and, if
 * so, why it can no longer be followed as committed.
 */
export type McRow = {
  policy: Policy;
  source: McSource;
  positionPmf: number[];
  ePos: number;
  ePoints: number;
  meanMs: number;
  quantiles: { p10: number; p50: number; p90: number };
  pGain: number;
  triggers: { kind: Trigger['kind']; fired: number; worthPos: number }[];
  diff: number;
  se: number;
  tie: boolean;
  committed: boolean;
  infeasible: null | 'stopLapPassed' | 'noSetLeft';
};

/**
 * `strategy.plans`: per our car the ranked rows and the run's metadata (scenarios run, whether the cap was hit, the
 * candidate count, the hazard's state, a near-tie left unresolved at the cap).
 */
export type StrategyOutput = Record<
  CarId,
  Known<{ rows: McRow[]; scenarios: number; capHit: boolean; candidates: number; hazard: Known<'ok'>; unresolvedTie: boolean }>
>;
