// Inputs for `race-monte-carlo`'s tests (SP4.3b Task 19). Starting points are built by hand with `race-forecast`'s
// test builder (`../race-forecast/start.ts`, which states how a starting point is read); `forecast-field` is the only
// builder in the product (C50), and these tests need fields it would never produce (a quiet field, a car far behind).
//
// How these tests read the simulator's inputs and outputs (the test agent's decisions, Task 19 report):
// - `hazard.byLap[i]` and `hazard.vscByLap[i]` are the chances an SC and a VSC start on lap `start.lap + i` (index 0 =
//   the leader's current lap, as `race-hazard`'s `byLap` starts at it); `scDur[d]` and `vscDur[d]` the chance one lasts
//   `d + 1` laps. A neutralisation starting on lap n and lasting d laps is out on laps n … n + d − 1 (a scenario's
//   `{ fromLap: n, toLap: n + d − 1 }`); no start while one is out or on the lap after it ends (`race-hazard`).
// - A row's `triggers[i]` belongs to `policy.triggers[i]`; `fired` is the share of the row's scenarios (0–1) in which
//   that trigger's condition held and the car did its action.
// - `positionPmf[p]` is P(position p + 1) at the flag; `meanMs` the mean race time from the starting point to the flag
//   (`race-forecast`'s `raceTimeMs`); `scenarios` per car the most scenarios any of its rows ran.
// - `fieldPositions`: `plans` holds our cars' plans (the cars of `start.sets`); the rivals' stops are drawn as in
//   `raceMonteCarlo` (their windows, the SC rule); `positionPmf[car][j][p]` is P(position p + 1 at the line ending lap
//   `laps[j]`).
import { type CarId, type McRow, type Policy, type StartingPoint } from '@pitwall/domain';
import type { FieldResult, McCandidate, McConfig, McInput, McResult, RivalRules } from '../../src/race-monte-carlo/index.ts';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** Spec §11.1's search and ranking, the cap from `strategy`'s config. */
export const CONFIG: McConfig = { n0: 40, zDrop: 2.8, zTie: 2, tieBand: 0.05, rescoreTop: 5, maxScenarioPolicies: 5_000, points: POINTS };

/** `strategy`'s config (research 19 §5): q 0.88, aMin 4, reactionLaps 0; no cover rule. */
export const RIVAL_RULES: RivalRules = { q: 0.88, aMin: 4, reactionLaps: 0, coverRule: false };

export type Hazard = McInput['hazard'];

/** A hazard over `laps` laps from the starting lap: per lap (1-based offset from `start.lap`, 0 = current) its chances. */
export function hazard(
  laps: number,
  o: { sc?: Record<number, number>; vsc?: Record<number, number>; scDur?: number[]; vscDur?: number[]; active?: Hazard['active'] } = {},
): Hazard {
  const byLap = new Float64Array(laps);
  const vscByLap = new Float64Array(laps);
  for (const [i, p] of Object.entries(o.sc ?? {})) byLap[Number(i)] = p;
  for (const [i, p] of Object.entries(o.vsc ?? {})) vscByLap[Number(i)] = p;
  return { byLap, vscByLap, scDur: Float64Array.from(o.scDur ?? [1]), vscDur: Float64Array.from(o.vscDur ?? [1]), active: o.active ?? null };
}

/** No SC or VSC on any lap. */
export const ZERO_HAZARD = (laps: number): Hazard => hazard(laps);

export const NO_STOP: Policy = { stops: [], triggers: [] };

export const stopAt = (lap: number, compound: Policy['stops'][number]['compound'] = 'hard'): Policy => ({ stops: [{ lap, compound }], triggers: [] });

export const candidate = (policy: Policy, source: McCandidate['source'] = 'dp'): McCandidate => ({ policy, source });

/** An input over `start` (its `sets` are our cars), every car's candidates as given, nothing committed by default. */
export function mcInput(
  start: StartingPoint,
  candidates: Record<number, Policy[] | McCandidate[]>,
  o: { hazard?: Hazard; committed?: Record<number, Policy | null>; rivalRules?: Partial<RivalRules>; config?: Partial<McConfig> } = {},
): McInput {
  const cands: Record<CarId, McCandidate[]> = {};
  for (const [car, list] of Object.entries(candidates)) cands[Number(car) as CarId] = list.map((c) => ('policy' in c && 'source' in c ? c : candidate(c)));
  const committed: Record<CarId, Policy | null> = {};
  for (const car of Object.keys(start.sets)) committed[Number(car) as CarId] = o.committed?.[Number(car)] ?? null;
  return {
    start,
    candidates: cands,
    committed,
    hazard: o.hazard ?? ZERO_HAZARD(start.lapsTotal - start.lap + 1),
    rivalRules: { ...RIVAL_RULES, ...o.rivalRules },
    config: { ...CONFIG, ...o.config },
  };
}

/** Car slot `car`'s result; throws when there is none. */
export function carOf(result: McResult, car: number): McResult[CarId] {
  const r = result[car as CarId];
  if (r === undefined) throw new Error(`no result for car ${car}`);
  return r;
}

/** Car slot `car`'s position pmfs (per requested lap); throws when there is none. */
export function pmfOf(result: FieldResult, car: number): number[][] {
  const r = result.positionPmf[car as CarId];
  if (r === undefined) throw new Error(`no position pmf for car ${car}`);
  return r;
}

/** A record by car slot. */
export const byCar = <T>(o: Record<number, T>): Record<CarId, T> => o as Record<CarId, T>;

export type Row = McRow;

/** The rows of `car` whose policy equals `policy`. */
export const rowsOf = <R extends { policy: Policy }>(rows: readonly R[], policy: Policy): R[] => rows.filter((r) => JSON.stringify(r.policy) === JSON.stringify(policy));

/** The one row of `car` whose policy equals `policy`; throws when there is none or more than one. */
export function rowOf<R extends { policy: Policy }>(rows: readonly R[], policy: Policy): R {
  const found = rowsOf(rows, policy);
  if (found.length !== 1) throw new Error(`expected one row for ${JSON.stringify(policy)}, found ${found.length}`);
  return found[0] as R;
}

/** The standard error of a share `p` over `n` draws. */
export const shareSe = (p: number, n: number): number => Math.sqrt((p * (1 - p)) / n);
