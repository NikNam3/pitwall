// `race-monte-carlo`'s plain inputs and outputs (SP4.3b spec §7, C50): candidate policies per car scored over common
// scenarios, adaptive under a scenario-policy cap. Structured-cloneable; not in `domain`, whose types are JSON-safe.
import type { CarId, McRow, McSource, Policy, StartingPoint } from '@pitwall/domain';
import type { DpInput } from '../strategy-dp/types.ts';

/** One candidate policy for one of our cars and where it came from. */
export type McCandidate = { policy: Policy; source: McSource };

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
