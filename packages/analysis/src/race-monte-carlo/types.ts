// `race-monte-carlo`'s plain inputs and outputs (SP4.3b spec §7, C50): candidate policies per car scored over common
// scenarios, adaptive under a scenario-policy cap. Structured-cloneable; not in `domain`, whose types are JSON-safe.
import type { CarId, McRow, McSource, Ms, Policy, StartingPoint } from '@pitwall/domain';
import type { DpInput } from '../strategy-dp/types.ts';

/** One candidate policy for one of our cars, where it came from and, for a rule candidate, its rule (else `null`). */
export type McCandidate = { policy: Policy; source: McSource; rule: McRow['rule'] };

/** The rivals' reaction rules (spec §7.2): under an SC a rival owing a stop with tyres ≥ `aMin` laps boxes with `q`. */
export type RivalRules = { q: number; aMin: number; reactionLaps: number; coverRule: boolean };

/** The search and ranking (spec §7.3) and the points table (position 1 first) as the run uses them. */
export type McConfig = {
  n0: number;
  zDrop: number;
  zTie: number;
  tieBand: number;
  rescoreTop: number;
  maxScenarioPolicies: number;
  points: number[];
};

export type McInput = {
  start: StartingPoint;
  candidates: Record<CarId, McCandidate[]>;
  committed: Record<CarId, Policy | null>;
  hazard: DpInput['hazard'] & { active: DpInput['active'] };
  rivalRules: RivalRules;
  config: McConfig;
};

/** Per our car its ranked rows, the scenarios run, whether the cap was hit and whether a near-tie stayed unresolved. */
export type McResult = Record<CarId, { rows: McRow[]; scenarios: number; capHit: boolean; unresolvedTie: boolean }>;

/** The field's positions at given laps under fixed plans, a fixed scenario count (`forecast-score`'s CRPS). */
export type FieldInput = { start: StartingPoint; plans: Record<CarId, Policy>; hazard: McInput['hazard']; rivalRules: RivalRules; scenarios: number; laps: number[] };

/** Per car, per requested lap, P(P1) … P(Pn). */
export type FieldResult = { positionPmf: Record<CarId, number[][]> };

/**
 * One call's case (4.3b2, spec §9): our policy; optionally a rival whose drawn stops this candidate replaces by its
 * policy, with the lap at whose crossing its gap is measured; the scenario stops at our crossing of `untilLap` (`null`:
 * to the flag).
 */
export type CallCandidate = {
  policy: Policy;
  rival: { carId: CarId; policy: Policy; gapAtLap: number } | null;
  /** The scenario stops at our crossing of this lap; `null` = to the flag. */
  untilLap: number | null;
};

/** A call's cases for one of our cars, scored on `scenarios` common scenarios each (no search, nothing dropped). */
export type CallInput = {
  start: StartingPoint;
  car: CarId;
  candidates: CallCandidate[];
  committed: Record<CarId, Policy | null>;
  hazard: McInput['hazard'];
  rivalRules: RivalRules;
  scenarios: number;
  traffic: { gapMs: Ms; laps: number };
};

/** One candidate's per-scenario outcomes. */
export type CallOutcome = {
  /** Position at `untilLap`, else at the flag. */
  finish: Int8Array;
  /** Position at our first line crossing after our first stop; -1: no stop. */
  rejoin: Int8Array;
  /** Distinct cars within `traffic.gapMs` of us at a line crossing in the first `traffic.laps` laps after the stop. */
  traffic: Int8Array;
  /** The rival's race time minus ours at its `gapAtLap` crossing (positive = we ahead); `null` without a rival. */
  gapMs: Float64Array | null;
  /** Race time at `untilLap`, else at the flag. */
  raceMs: Float64Array;
};

/** Per candidate, per scenario; scenario i is the same draw for every candidate (common random numbers). */
export type CallResult = { outcomes: CallOutcome[] };
