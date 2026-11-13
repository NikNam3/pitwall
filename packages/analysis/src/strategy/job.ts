// `strategy`'s job (C51; SP4.3b spec §8.1), run in one part per our car (SP4.3b Q4 D, Task 25), each in a worker: the
// candidates per our car, the part's car planned against the teammate, then `race-monte-carlo` under the scenario-policy
// cap. No state between runs (C31, C32).
//
// - Per car the DP (`strategy-dp`) from the car's lap on (`startLapOf`), its input from the starting point, the hazard
//   and the plain forecast (traffic per rejoin lap; the wetness as now, which a plain scenario keeps); its result gives
//   the candidates (`candidates.ts`). A committed policy is followed as far as it can be (spec §8.2): a passed stop
//   boxes this lap, a stop onto a compound without a set left is dropped; its row is marked with the reason.
// - The parts (spec §7.3 item 4, §8.1 step 3): `splitStrategy` gives one part per our car planned (`planCar`), or the
//   input as it is when none can be planned; `mergeStrategy` takes each car's entry from the part that planned it and
//   every other entry from the first part. `run` without `planCar` runs the parts one after another on one rng.
// - A part's rounds (spec §8.1 step 2): the teammate committed, the part's car is ranked against the commit with the
//   whole cap (`maxScenarioPolicies`). Else round 1 plans the teammate with `floor(cap × round1Share)` (against the
//   car's commit if it has one, else the car modelled like a rival: left out of `start.sets`) and the car is ranked
//   against the teammate's round-1 best with the rest. A car planned alone, or a round 1 of no scenario-policy, gets
//   the whole cap with the other modelled like a rival.
// - `candidatesForRun` is the candidate step's one place and `partFinalCall` a part's final call's;
//   `scripts/gen-strategy-reference.ts` builds its input with them.
import { known, NOISE_COMPOUNDS, unknown, type CarId, type Known, type McRow, type NoiseCompound, type Policy, type RaceHazard, type StartingPoint, type StrategyOutput } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { raceForecast, startLapOf } from '../race-forecast/index.ts';
import { raceMonteCarlo, rivalNextCompound, type McCandidate, type McConfig, type McInput, type McResult, type RivalRules } from '../race-monte-carlo/index.ts';
import { strategyDp, type DpInput } from '../strategy-dp/index.ts';
import { candidatesOf } from './candidates.ts';
import { STRATEGY_CONFIG, type StrategyConfig } from './config.ts';
import type { StrategyInput } from './prepare.ts';

type Hazard = McInput['hazard'];
type Infeasible = McRow['infeasible'];

/** `race-hazard`'s tables per lap from the leader's lap (index 0 = `start.lap`); without them, no neutralisation drawn. */
function hazardOf(start: StartingPoint, hazard: RaceHazard): Hazard {
  const n = Math.max(0, start.lapsTotal - start.lap + 1);
  const byLap = new Float64Array(n);
  const vscByLap = new Float64Array(n);
  if (!hazard.known) return { byLap, vscByLap, scDur: Float64Array.of(1), vscDur: Float64Array.of(1), active: null };
  const h = hazard.value;
  for (const entry of h.byLap) {
    const i = entry.lap - start.lap;
    if (i < 0 || i >= n) continue;
    byLap[i] = entry.sc;
    vscByLap[i] = entry.vsc;
  }
  const active = h.active === null ? null : { condition: h.active.condition, remaining: Float64Array.from(h.active.remainingLaps) };
  return { byLap, vscByLap, scDur: Float64Array.from(h.durationLaps.sc), vscDur: Float64Array.from(h.durationLaps.vsc), active };
}

/** The plain forecast's road: per lap from `start.lap` each car's gap to the leader at that lap's line (0 = retired). */
function plainRoad(start: StartingPoint, rng: Rng): Map<number, { gapMs: Float64Array; position: Int8Array }> {
  const ours = new Set(Object.keys(start.sets).map(Number));
  // the rivals at their likeliest stop (rival-stops' window, its next compound); our cars without a stop
  const policies: Policy[] = Array.from({ length: start.cars }, (_, k): Policy => {
    const compound = ours.has(k) ? null : rivalNextCompound(start, k);
    const lap = start.stopMid[k] ?? start.lapsTotal;
    return compound === null || lap < start.lap || lap >= start.lapsTotal ? { stops: [], triggers: [] } : { stops: [{ lap, compound }], triggers: [] };
  });
  const result = raceForecast(start, policies, { id: 0, plain: true, neutralisations: [] }, rng, { trace: true });
  return new Map((result.trace ?? []).map((t) => [t.lap, { gapMs: t.gapMs, position: t.position }]));
}

/** Per lap from `fromLap` the traffic cost of a rejoin at its end: the shortfall to `trafficGapMs` of each car ahead within it. */
function trafficOf(start: StartingPoint, road: ReturnType<typeof plainRoad>, car: CarId, fromLap: number, trafficGapMs: number): Float64Array {
  const out = new Float64Array(start.lapsTotal - fromLap + 1);
  for (let i = 0; i < out.length; i++) {
    const line = road.get(fromLap + i);
    if (line === undefined || (line.position[car] ?? 0) === 0) continue;
    const rejoin = (line.gapMs[car] ?? 0) + start.track.pitLossMs.green;
    let cost = 0;
    for (let k = 0; k < start.cars; k++) {
      if (k === car || (line.position[k] ?? 0) === 0) continue;
      const d = rejoin - (line.gapMs[k] ?? 0);
      if (d >= 0 && d < trafficGapMs) cost += trafficGapMs - d;
    }
    out[i] = cost;
  }
  return out;
}

/** The DP's input for car `car` from its lap `fromLap` (spec §6). */
function dpInputOf(start: StartingPoint, car: CarId, fromLap: number, hazard: Hazard, traffic: Float64Array): DpInput {
  const n = start.lapsTotal - fromLap + 1;
  const shifted = (a: Float64Array): Float64Array => Float64Array.from({ length: n }, (_, i) => a[fromLap + i - start.lap] ?? 0);
  const rate = start.wearRatePct[car] ?? 0;
  const wearRatePct = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, rate])) as Record<NoiseCompound, number>;
  // new sets only (spec §6, K5)
  const sets = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, 0])) as Record<NoiseCompound, number>;
  for (const s of start.sets[car] ?? []) if (s.wearPct <= 0) sets[s.compound] += 1;
  return {
    car,
    fromLap,
    totalLaps: start.lapsTotal,
    lap: start.lapModel,
    carParams: {
      compound: NOISE_COMPOUNDS[start.compound[car] ?? 1] ?? 'medium',
      tyreAge: start.tyreAge[car] ?? 0,
      wearPct: start.wearPct[car] ?? 0,
      fuelKg: start.fuelKg[car] ?? 0,
      paceMs: start.paceMs[car] ?? 0,
      degMsPerLap: start.degMsPerLap[car] ?? 0,
      wearRatePct,
      human: start.human[car] === 1,
    },
    sets,
    owesSecondCompound: start.owesStop[car] === 1,
    pitLossMs: start.track.pitLossMs,
    hazard: { byLap: shifted(hazard.byLap), vscByLap: shifted(hazard.vscByLap), scDur: hazard.scDur, vscDur: hazard.vscDur },
    active: hazard.active,
    wetnessByLap: new Float64Array(n).fill(start.wetness.wetnessMs),
    trafficMsByLap: traffic,
  };
}

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
function mcConfigOf(config: StrategyConfig): McConfig {
  return {
    n0: config.n0,
    zDrop: config.zDrop,
    zTie: config.zTie,
    tieBand: config.tieBand,
    rescoreTop: config.rescoreTop,
    maxScenarioPolicies: config.maxScenarioPolicies,
    points: String(config.points).split(',').map((p) => Number(p.trim())),
  };
}

/** One car's plan as the job holds it: its candidates and, where committed, the policy followed and the commit's reason. */
export type CarPlan = { candidates: McCandidate[]; followed: Policy | null; original: Policy | null; infeasible: Infeasible };

/** `strategy`'s config as the run reads it. */
const configOf = (input: StrategyInput): StrategyConfig => ({ ...STRATEGY_CONFIG.defaults, ...input.config[STRATEGY_CONFIG.key] }) as StrategyConfig;

/** Why the job does not plan car `car`, or `null` when it does: by the behaviour table, running, in the field, with its sets known and a lap left to plan. */
function notPlannedWhy(input: StrategyInput, start: StartingPoint, car: CarId): 'notApplicable' | 'insufficientData' | null {
  const applicable = input.planned.includes(car) && car < start.cars && start.retired[car] !== 1 && startLapOf(start, car) <= start.lapsTotal;
  if (!applicable) return 'notApplicable';
  return start.sets[car] === undefined ? 'insufficientData' : null;
}

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
  const config = configOf(input);

  const planned = new Set<CarId>();
  for (const car of input.ourCars) {
    const why = notPlannedWhy(input, start, car);
    if (why === null) planned.add(car);
    else out[car] = unknown(why);
  }
  if (planned.size === 0) return { mc: null, perCar, out };
  // a car of ours not planned is modelled like a rival
  const sets: StartingPoint['sets'] = {};
  for (const car of planned) sets[car] = start.sets[car] ?? [];
  const field: StartingPoint = { ...start, sets };
  const hazard = hazardOf(field, input.hazard);

  const road = plainRoad(field, rng);
  const candidates: Record<CarId, McCandidate[]> = {};
  const committed: Record<CarId, Policy | null> = {};
  for (const car of planned) {
    const fromLap = startLapOf(field, car);
    const dp = strategyDp(dpInputOf(field, car, fromLap, hazard, trafficOf(field, road, car, fromLap, config.trafficGapMs)));
    const own = candidatesOf(field, car, dp, config);
    const original = input.committed[car] ?? null;
    let plan: CarPlan = { candidates: own, followed: null, original: null, infeasible: null };
    if (original !== null) {
      const f = followable(field, car, original);
      const key = JSON.stringify(f.policy);
      const withCommit = [{ policy: f.policy, source: 'committed' as const }, ...own.filter((c) => JSON.stringify(c.policy) !== key)];
      plan = { candidates: withCommit, followed: f.policy, original, infeasible: f.infeasible };
    }
    perCar.set(car, plan);
    candidates[car] = plan.candidates;
    committed[car] = plan.followed;
  }
  const rivalRules: RivalRules = { q: config.rivalScBoxChance, aMin: config.rivalScMinTyreAge, reactionLaps: config.rivalReactionLaps, coverRule: false };
  return { mc: { start: field, candidates, committed, hazard, rivalRules, config: mcConfigOf(config) }, perCar, out };
}

/** The job's parts (C51): one per our car planned, in our cars' order, each `{ ...input, planCar }`; the input as it is when none can be planned. */
export function splitStrategy(input: StrategyInput): StrategyInput[] {
  const s = input.start;
  const cars = s.known ? input.ourCars.filter((car) => notPlannedWhy(input, s.value, car) === null) : [];
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
  const config = configOf(input);
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

/** One part: its car's ranked policies, the other entries as `candidatesForRun` gives them. */
function runPart(input: StrategyInput, rng: Rng): StrategyOutput {
  const { final, perCar, out } = partFinalCall(input, rng);
  const { start: s } = input;
  if (final === null || !s.known) return out;
  // as of the starting point: the hazard's own time is when its calculator last ran, which its cadence decides
  const hazardState: Known<'ok'> = input.hazard.known ? known('ok', s.at) : input.hazard;
  const own = perCar.get(final.car) as CarPlan;
  const r = raceMonteCarlo(final.mc, rng, final.mc.config.maxScenarioPolicies)[final.car] as McResult[CarId];
  const rows = r.rows.map((row): McRow => (row.committed ? { ...row, policy: own.original ?? row.policy, source: 'committed', infeasible: own.infeasible } : row));
  out[final.car] = known({ rows, scenarios: r.scenarios, capHit: r.capHit, candidates: own.candidates.length, hazard: hazardState, unresolvedTie: r.unresolvedTie }, s.at);
  return out;
}

/** Our cars' ranked policies (runs in a worker): the part's car with `planCar`, else every part one after another on `rng`. */
export function run(input: StrategyInput, rng: Rng): StrategyOutput {
  if (input.planCar !== undefined) return runPart(input, rng);
  return mergeStrategy(splitStrategy(input).map((part) => runPart(part, rng)));
}
