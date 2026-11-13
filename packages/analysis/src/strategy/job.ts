// `strategy`'s job (C51; SP4.3b spec §8.1), run in one part per our car (SP4.3b Q4 D, Task 25), each in a worker: the
// candidates per our car, the part's car planned against the teammate, then `race-monte-carlo` under the scenario-policy
// cap. No state between runs (C31, C32).
//
// - Per car the DP (`strategy-dp`) from the car's lap on (`startLapOf`), its input from the starting point, the hazard
//   and the plain forecast (`shared/strategy-input/`, SP4.3b2 Task 6); its result gives the candidates
//   (`candidates.ts`). A committed policy is followed as far as it can be (spec §8.2): a passed stop boxes this lap, a
//   stop onto a compound without a set left is dropped; its row is marked with the reason.
// - The parts (spec §7.3 item 4, §8.1 step 3): `splitStrategy` gives one part per our car planned (`planCar`), or the
//   input as it is when none can be planned; `mergeStrategy` takes each car's entry from the part that planned it and
//   every other entry from the first part. `run` without `planCar` runs the parts one after another on one rng.
// - A part's rounds (spec §8.1 step 2): the teammate committed, the part's car is ranked against the commit with the
//   whole cap (`maxScenarioPolicies`). Else round 1 plans the teammate with `floor(cap × round1Share)` (against the
//   car's commit if it has one, else the car modelled like a rival: left out of `start.sets`) and the car is ranked
//   against the teammate's round-1 best with the rest. A car planned alone, or a round 1 of no scenario-policy, gets
//   the whole cap with the other modelled like a rival.
// - The table's fields (SP4.3b2 Task 6, spec §10): per row its rank (tied rows share the leader's, then index + 1), its
//   mean race time against the leader's and the committed row's; per car its race position at the trigger.
// - `candidatesForRun` is the candidate step's one place and `partFinalCall` a part's final call's;
//   `scripts/gen-strategy-reference.ts` builds its input with them.
import { known, unknown, type CarId, type Known, type McRow, type NoiseCompound, type Policy, type StartingPoint, type StrategyOutput } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { raceMonteCarlo, type McCandidate, type McConfig, type McInput, type McResult } from '../race-monte-carlo/index.ts';
import { dpInputOn, mcSettingsFrom, notPlannedWhy, plainRoad, plannedCars, plannedField, strategyConfigOf, toMcHazard, type StrategyInput } from '../shared/strategy-input/index.ts';
import { strategyDp } from '../strategy-dp/index.ts';
import { candidatesOf } from './candidates.ts';
import type { StrategyConfig } from './config.ts';

type Infeasible = McRow['infeasible'];

/**
 * A committed policy as far as car `car` can follow it (spec §8.2): a passed stop boxes this lap (one stop a lap), a
 * stop onto a compound without a set left is dropped (the car keeps its tyres); the reason, the first found.
 */
export function followable(start: StartingPoint, car: CarId, policy: Policy): { policy: Policy; infeasible: Infeasible } {
  const fromLap = startLapOf(start, car);
  let infeasible: Infeasible = null;
  const onLaps: Policy['stops'] = [];
  for (const s of policy.stops) {
    if (s.lap < fromLap) infeasible ??= 'stopLapPassed';
    const lap = Math.max(s.lap, fromLap);
    const last = onLaps.at(-1);
    if (last !== undefined && last.lap >= lap) continue;
    onLaps.push({ lap, compound: s.compound });
  }
  const left = new Map<NoiseCompound, number>();
  for (const s of start.sets[car] ?? []) left.set(s.compound, (left.get(s.compound) ?? 0) + 1);
  const stops: Policy['stops'] = [];
  for (const s of onLaps) {
    const n = left.get(s.compound) ?? 0;
    if (n <= 0) {
      infeasible ??= 'noSetLeft';
      continue;
    }
    left.set(s.compound, n - 1);
    stops.push(s);
  }
  return { policy: infeasible === null ? policy : { stops, triggers: policy.triggers }, infeasible };
}

/** The search's settings from the config (spec §7.3, §11.1). */
function mcConfigOf(config: StrategyConfig, points: number[]): McConfig {
  return {
    n0: config.n0,
    zDrop: config.zDrop,
    zTie: config.zTie,
    tieBand: config.tieBand,
    rescoreTop: config.rescoreTop,
    maxScenarioPolicies: config.maxScenarioPolicies,
    points,
  };
}

/** One car's plan as the job holds it: its candidates and, where committed, the policy followed and the commit's reason. */
export type CarPlan = { candidates: McCandidate[]; followed: Policy | null; original: Policy | null; infeasible: Infeasible };

/**
 * The job's candidate step, its one place: the cars planned and, per car, its candidates (a committed policy first, as
 * far as it can be followed). `mc` is the `race-monte-carlo` input with every planned car's candidates, the committed
 * policies, the hazard, the rival rules and the config's search settings at the whole cap; `null` when no car is
 * planned. `out` holds the cars not planned, each with its reason. Draws the plain forecast from `rng`.
 */
export function candidatesForRun(input: StrategyInput, rng: Rng): { mc: McInput | null; perCar: Map<CarId, CarPlan>; out: StrategyOutput } {
  const out: StrategyOutput = {};
  const perCar = new Map<CarId, CarPlan>();
  const { start: s } = input;
  if (!s.known) {
    for (const car of input.ourCars) out[car] = unknown(s.reason);
    return { mc: null, perCar, out };
  }
  const start = s.value;
  const config = strategyConfigOf(input.config);

  const planned = new Set<CarId>();
  for (const car of input.ourCars) {
    const why = notPlannedWhy(input, start, car);
    if (why === null) planned.add(car);
    else out[car] = unknown(why);
  }
  if (planned.size === 0) return { mc: null, perCar, out };
  const field = plannedField(start, planned);
  const hazard = toMcHazard(input.hazard, field);

  const road = plainRoad(field, rng);
  const candidates: Record<CarId, McCandidate[]> = {};
  const committed: Record<CarId, Policy | null> = {};
  for (const car of planned) {
    const dp = strategyDp(dpInputOn(field, car, hazard, road, config.trafficGapMs));
    const own = candidatesOf(field, car, dp, config);
    const original = input.committed[car] ?? null;
    let plan: CarPlan = { candidates: own, followed: null, original: null, infeasible: null };
    if (original !== null) {
      const f = followable(field, car, original);
      const key = JSON.stringify(f.policy);
      const withCommit = [{ policy: f.policy, source: 'committed' as const, rule: null }, ...own.filter((c) => JSON.stringify(c.policy) !== key)];
      plan = { candidates: withCommit, followed: f.policy, original, infeasible: f.infeasible };
    }
    perCar.set(car, plan);
    candidates[car] = plan.candidates;
    committed[car] = plan.followed;
  }
  const { rivalRules, points } = mcSettingsFrom(input.config);
  return { mc: { start: field, candidates, committed, hazard, rivalRules, config: mcConfigOf(config, points) }, perCar, out };
}

/** The job's parts (C51): one per our car planned, in our cars' order, each `{ ...input, planCar }`; the input as it is when none can be planned. */
export function splitStrategy(input: StrategyInput): StrategyInput[] {
  const s = input.start;
  const cars = s.known ? plannedCars(input, s.value) : [];
  return cars.length === 0 ? [input] : cars.map((planCar) => ({ ...input, planCar }));
}

/** The parts' outputs joined: each car's entry from the part that planned it (its known one), every other from the first part. */
export function mergeStrategy(outs: readonly StrategyOutput[]): StrategyOutput {
  const merged: StrategyOutput = {};
  for (const out of outs) {
    for (const [key, entry] of Object.entries(out)) {
      const car = Number(key) as CarId;
      if (entry.known || merged[car] === undefined) merged[car] = entry;
    }
  }
  return merged;
}

/** A part's final ranking: its car and its `race-monte-carlo` input, the call's cap in `config.maxScenarioPolicies`. */
export type FinalCall = { car: CarId; mc: McInput };

/**
 * A part up to its final call: its candidate step and, with its teammate uncommitted, its round 1 (both drawn from
 * `rng`). `final` is `null` without `planCar` or when the part's car is not planned; `perCar` and `out` as
 * `candidatesForRun` gives them.
 */
export function partFinalCall(input: StrategyInput, rng: Rng): { final: FinalCall | null; perCar: Map<CarId, CarPlan>; out: StrategyOutput } {
  const { mc: all, perCar: cars, out } = candidatesForRun(input, rng);
  const car = input.planCar;
  if (all === null || car === undefined || !cars.has(car)) return { final: null, perCar: cars, out };
  const config = strategyConfigOf(input.config);
  const done = (final: FinalCall) => ({ final, perCar: cars, out });

  /** Car `c` planned under `cap`; `mate` our other car as certain input following `fixed`, else (absent) modelled like a rival. */
  const callOf = (c: CarId, cap: number, mate?: { car: CarId; fixed: Policy }): FinalCall => {
    const own = cars.get(c) as CarPlan;
    const callSets: StartingPoint['sets'] = { [c]: all.start.sets[c] ?? [] };
    const committed: Record<CarId, Policy | null> = { [c]: own.followed };
    if (mate !== undefined) {
      callSets[mate.car] = all.start.sets[mate.car] ?? [];
      committed[mate.car] = mate.fixed;
    }
    return { car: c, mc: { ...all, start: { ...all.start, sets: callSets }, candidates: { [c]: own.candidates }, committed, config: { ...all.config, maxScenarioPolicies: cap } } };
  };

  // the cap (a count, C2) is the part's whole: round 1 its share rounded down, the final call the rest
  const total = config.maxScenarioPolicies;
  const mate = [...cars.keys()].find((c) => c !== car);
  if (mate === undefined) return done(callOf(car, total));
  const mateFollowed = (cars.get(mate) as CarPlan).followed;
  if (mateFollowed !== null) return done(callOf(car, total, { car: mate, fixed: mateFollowed }));
  const round1Cap = Math.floor(total * config.round1Share);
  if (round1Cap <= 0) return done(callOf(car, total));
  const ownFollowed = (cars.get(car) as CarPlan).followed;
  const round1 = callOf(mate, round1Cap, ownFollowed === null ? undefined : { car, fixed: ownFollowed });
  const best = ((raceMonteCarlo(round1.mc, rng, round1Cap)[mate] as McResult[CarId]).rows[0] as McRow).policy;
  return done(callOf(car, total - round1Cap, { car: mate, fixed: best }));
}

/** The car's place in the starting point's order, retired cars skipped: its position when the view gave none. */
function orderPlaceOf(start: StartingPoint, car: CarId): number {
  let p = 0;
  for (const c of start.order) {
    if (start.retired[c] === 1) continue;
    p++;
    if (c === car) return p;
  }
  return start.cars;
}

/**
 * The table's fields of ranked rows (spec §10): tied rows share their leader's rank (the first row's), every other row
 * its index + 1; each row's mean race time against the first row's and, with a committed row, against it.
 */
function withTableFields(rows: readonly McRow[]): McRow[] {
  const leader = rows[0];
  const plan = rows.find((r) => r.committed);
  return rows.map((row, i) => ({
    ...row,
    rank: i > 0 && row.tie ? 1 : i + 1,
    deltaLeaderMs: leader === undefined ? 0 : row.meanMs - leader.meanMs,
    deltaPlanMs: plan === undefined ? null : row.meanMs - plan.meanMs,
  }));
}

/** One part: its car's ranked policies, the other entries as `candidatesForRun` gives them. */
function runPart(input: StrategyInput, rng: Rng): StrategyOutput {
  const { final, perCar, out } = partFinalCall(input, rng);
  const { start: s } = input;
  if (final === null || !s.known) return out;
  // as of the starting point: the hazard's own time is when its calculator last ran, which its cadence decides
  const hazardState: Known<'ok'> = input.hazard.known ? known('ok', s.at) : input.hazard;
  const own = perCar.get(final.car) as CarPlan;
  const r = raceMonteCarlo(final.mc, rng, final.mc.config.maxScenarioPolicies)[final.car] as McResult[CarId];
  const rows = withTableFields(r.rows.map((row): McRow => (row.committed ? { ...row, policy: own.original ?? row.policy, source: 'committed', infeasible: own.infeasible } : row)));
  const currentPosition = input.positions[final.car] ?? orderPlaceOf(s.value, final.car);
  out[final.car] = known({ rows, scenarios: r.scenarios, capHit: r.capHit, candidates: own.candidates.length, hazard: hazardState, unresolvedTie: r.unresolvedTie, currentPosition }, s.at);
  return out;
}

/** Our cars' ranked policies (runs in a worker): the part's car with `planCar`, else every part one after another on `rng`. */
export function run(input: StrategyInput, rng: Rng): StrategyOutput {
  if (input.planCar !== undefined) return runPart(input, rng);
  return mergeStrategy(splitStrategy(input).map((part) => runPart(part, rng)));
}
