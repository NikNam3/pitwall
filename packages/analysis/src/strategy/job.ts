// `strategy`'s job (C51; SP4.3b spec §8.1), run in a worker: the candidates per our car, the two rounds of planning
// against the teammate, then `race-monte-carlo` under the scenario-policy cap. No state between runs (C31, C32).
//
// - Per car the DP (`strategy-dp`) from the car's lap on (`startLapOf`), its input from the starting point, the hazard
//   and the plain forecast (traffic per rejoin lap; the wetness as now, which a plain scenario keeps); its result gives
//   the candidates (`candidates.ts`). A committed policy is followed as far as it can be (spec §8.2): a passed stop
//   boxes this lap, a stop onto a compound without a set left is dropped; its row is marked with the reason.
// - The rounds (spec §8.1 step 2): a committed policy is certain input for the other car; with no commit on either car,
//   round 1 plans each against the other modelled like a rival (left out of `start.sets`), round 2 against the other's
//   round-1 best. A car planned alone (the other not planned) has the other modelled like a rival.
// - The cap (`maxScenarioPolicies`) covers the whole run (Task 20d): round 1 gets `round1Share` of it, split over the
//   cars planned; the final calls share the rest; each share rounded down. Without round 1 (one car planned, a commit,
//   `round1Share` 0 or a round-1 share below one per car) the final calls share the whole cap.
// - `candidatesForRun` is the candidate step's one place; `scripts/gen-strategy-reference.ts` builds its input with it.
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

  // the cars planned: by the behaviour table, running, in the field, with their sets known and a lap left to plan
  const planned = new Set<CarId>();
  for (const car of input.ourCars) {
    const applicable = input.planned.includes(car) && car < start.cars && start.retired[car] !== 1 && startLapOf(start, car) <= start.lapsTotal;
    if (!applicable) out[car] = unknown('notApplicable');
    else if (start.sets[car] === undefined) out[car] = unknown('insufficientData');
    else planned.add(car);
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

/** Our cars' ranked policies (runs in a worker). */
export function run(input: StrategyInput, rng: Rng): StrategyOutput {
  const { mc: all, perCar: cars, out } = candidatesForRun(input, rng);
  const { start: s } = input;
  if (all === null || !s.known) return out;
  const config = configOf(input);
  // as of the starting point: the hazard's own time is when its calculator last ran, which its cadence decides
  const hazardState: Known<'ok'> = input.hazard.known ? known('ok', s.at) : input.hazard;

  const ids = [...cars.keys()];
  const other = (car: CarId): CarId | undefined => ids.find((c) => c !== car);
  const anyCommitted = ids.some((c) => cars.get(c)?.followed !== null);
  // the cap (a count, C2): round 1 its share split over the cars, the final calls the rest; each share rounded down
  const total = config.maxScenarioPolicies;
  const round1Each = ids.length === 1 || anyCommitted ? 0 : Math.floor(Math.floor(total * config.round1Share) / ids.length);
  const finalEach = Math.floor((total - round1Each * ids.length) / ids.length);

  /** Car `car` planned under `cap`; `mate` our other car as certain input following `fixed`, else (absent) modelled like a rival. */
  const plan = (car: CarId, cap: number, mate?: { car: CarId; fixed: Policy }): McResult[CarId] => {
    const own = cars.get(car) as CarPlan;
    const callSets: StartingPoint['sets'] = { [car]: all.start.sets[car] ?? [] };
    const committed: Record<CarId, Policy | null> = { [car]: own.followed };
    if (mate !== undefined) {
      callSets[mate.car] = all.start.sets[mate.car] ?? [];
      committed[mate.car] = mate.fixed;
    }
    const mc: McInput = { ...all, start: { ...all.start, sets: callSets }, candidates: { [car]: own.candidates }, committed, config: { ...all.config, maxScenarioPolicies: cap } };
    return raceMonteCarlo(mc, rng, cap)[car] as McResult[CarId];
  };
  const bestOf = (r: McResult[CarId]): Policy => (r.rows[0] as McRow).policy;

  const results = new Map<CarId, McResult[CarId]>();
  if (!anyCommitted && round1Each === 0) {
    // one car planned, or no round 1: each car against the other modelled like a rival
    for (const car of ids) results.set(car, plan(car, finalEach));
  } else if (!anyCommitted) {
    const round1 = new Map(ids.map((car) => [car, plan(car, round1Each)] as const));
    for (const car of ids) {
      const mate = other(car) as CarId;
      results.set(car, plan(car, finalEach, { car: mate, fixed: bestOf(round1.get(mate) as McResult[CarId]) }));
    }
  } else {
    // the cars whose teammate committed first, against its commit; then the others against its best of that run
    const first = ids.filter((car) => cars.get(other(car) as CarId)?.followed !== null);
    for (const car of first) {
      const mate = other(car) as CarId;
      results.set(car, plan(car, finalEach, { car: mate, fixed: cars.get(mate)?.followed as Policy }));
    }
    for (const car of ids.filter((c) => !first.includes(c))) {
      const mate = other(car) as CarId;
      results.set(car, plan(car, finalEach, { car: mate, fixed: bestOf(results.get(mate) as McResult[CarId]) }));
    }
  }

  for (const car of ids) {
    const own = cars.get(car) as CarPlan;
    const r = results.get(car) as McResult[CarId];
    const rows = r.rows.map((row): McRow => (row.committed ? { ...row, policy: own.original ?? row.policy, source: 'committed', infeasible: own.infeasible } : row));
    out[car] = known({ rows, scenarios: r.scenarios, capHit: r.capHit, candidates: own.candidates.length, hazard: hazardState, unresolvedTie: r.unresolvedTie }, s.at);
  }
  return out;
}
