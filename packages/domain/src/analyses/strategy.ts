// Value types of the `strategy` analysis (SP4.3b spec §7.4, §8.1): per our car the candidate policies `race-monte-carlo`
// ranked, and the run's metadata. JSON-safe: the topic `strategy.plans` publishes it as a job's result (C51).
import type { Policy } from '../forecast.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Slot } from '../plan-slots.ts';

/**
 * Where a candidate policy came from: the DP, a stop-lap neighbour of a DP plan, a rule candidate, the active plan
 * committed without a slot, a saved plan slot (`plan`), a game-strategy slot (`game`).
 */
export type McSource = 'dp' | 'neighbour' | 'rule' | 'committed' | 'plan' | 'game';

/**
 * One ranked policy (spec §7.4): the finishing-position pmf (P1 … Pn), E[position], E[points], the mean race time,
 * position quantiles, the chance to gain a place at the finish; its paired difference and SE against the leader and whether it ties; whether it is the committed plan and, if
 * so, why it can no longer be followed as committed.
 */
export type McRow = {
  policy: Policy;
  source: McSource;
  /** The plan slot the row is, or `null` for a row that is no slot. */
  slot: Slot | null;
  positionPmf: number[];
  ePos: number;
  ePoints: number;
  meanMs: number;
  quantiles: { p10: number; p50: number; p90: number };
  pGain: number;
  diff: number;
  se: number;
  tie: boolean;
  committed: boolean;
  infeasible: null | 'stopLapPassed' | 'noSetLeft';
  /** The row's rank: tied rows share their leader's rank; then index + 1. */
  rank: number;
  /** Mean race time against `rows[0]` (ms). */
  deltaLeaderMs: number;
  /** Mean race time against the active row (ms), the board's ΔTIME; `null` without an active plan. */
  deltaPlanMs: number | null;
  /** The paired mean difference in places against the active plan (ΔPOS); `unknown('notApplicable')` on the active row and without one. */
  diffPlan: Known<number>;
  /** The standard error of `diffPlan` in places; `unknown('notApplicable')` on the active row and without one. */
  sePlan: Known<number>;
  /** The rule candidate's rule (the SRC hover); `null` unless `source` is `'rule'`. */
  rule: 'mirrorAhead' | 'mirrorBehind' | null;
};

/**
 * `strategy.plans`: per our car the ranked rows and the run's metadata (scenarios run, whether the cap was hit, the
 * candidate count, the hazard's state, a near-tie left unresolved at the cap, the car's position at the trigger).
 */
export type StrategyOutput = Record<
  CarId,
  Known<{ rows: McRow[]; bestPerStops: Partial<Record<0 | 1 | 2 | 3, number>>; scenarios: number; capHit: boolean; candidates: number; hazard: Known<'ok'>; unresolvedTie: boolean; currentPosition: number }>
>;

/** `strategy.car`: one car's entry of `StrategyOutput`. */
export type StrategyCar = StrategyOutput[CarId];
