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
// - The cap (`maxScenarioPolicies`) covers the whole run: shared evenly by the run's calls.
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
type Car = { candidates: McCandidate[]; followed: Policy | null; original: Policy | null; infeasible: Infeasible };

/** Our cars' ranked policies (runs in a worker). */
export function run(input: StrategyInput, rng: Rng): StrategyOutput {
  const out: StrategyOutput = {};
  const { start: s } = input;
  if (!s.known) {
    for (const car of input.ourCars) out[car] = unknown(s.reason);
    return out;
  }
  const start = s.value;
  const config = { ...STRATEGY_CONFIG.defaults, ...input.config[STRATEGY_CONFIG.key] } as StrategyConfig;
  const hazard = hazardOf(start, input.hazard);
  // as of the starting point: the hazard's own time is when its calculator last ran, which its cadence decides
  const hazardState: Known<'ok'> = input.hazard.known ? known('ok', s.at) : input.hazard;

  // the cars planned: by the behaviour table, running, in the field, with their sets known and a lap left to plan
  const planned = new Set<CarId>();
  for (const car of input.ourCars) {
    const applicable = input.planned.includes(car) && car < start.cars && start.retired[car] !== 1 && startLapOf(start, car) <= start.lapsTotal;
    if (!applicable) out[car] = unknown('notApplicable');
    else if (start.sets[car] === undefined) out[car] = unknown('insufficientData');
    else planned.add(car);
  }
  if (planned.size === 0) return out;
  // a car of ours not planned is modelled like a rival
  const sets: StartingPoint['sets'] = {};
  for (const car of planned) sets[car] = start.sets[car] ?? [];
  const field: StartingPoint = { ...start, sets };

  const road = plainRoad(field, rng);
  const cars = new Map<CarId, Car>();
  for (const car of planned) {
    const fromLap = startLapOf(field, car);
    const dp = strategyDp(dpInputOf(field, car, fromLap, hazard, trafficOf(field, road, car, fromLap, config.trafficGapMs)));
    const own = candidatesOf(field, car, dp, config);
    const original = input.committed[car] ?? null;
    if (original === null) {
      cars.set(car, { candidates: own, followed: null, original: null, infeasible: null });
      continue;
    }
    const f = followable(field, car, original);
    const key = JSON.stringify(f.policy);
    const candidates = [{ policy: f.policy, source: 'committed' as const }, ...own.filter((c) => JSON.stringify(c.policy) !== key)];
    cars.set(car, { candidates, followed: f.policy, original, infeasible: f.infeasible });
  }

  const ids = [...planned];
  const other = (car: CarId): CarId | undefined => ids.find((c) => c !== car);
  const anyCommitted = ids.some((c) => cars.get(c)?.followed !== null);
  const calls = ids.length === 1 ? 1 : anyCommitted ? 2 : 4;
  const cap = Math.floor(config.maxScenarioPolicies / calls);
  const mcConfig = mcConfigOf(config);
  const rivalRules: RivalRules = { q: config.rivalScBoxChance, aMin: config.rivalScMinTyreAge, reactionLaps: config.rivalReactionLaps, coverRule: false };

  /** Car `car` planned; `with` our other car as certain input following `fixed`, else (absent) modelled like a rival. */
  const plan = (car: CarId, mate?: { car: CarId; fixed: Policy }): McResult[CarId] => {
    const own = cars.get(car) as Car;
    const callSets: StartingPoint['sets'] = { [car]: sets[car] ?? [] };
    const committed: Record<CarId, Policy | null> = { [car]: own.followed };
    if (mate !== undefined) {
      callSets[mate.car] = sets[mate.car] ?? [];
      committed[mate.car] = mate.fixed;
    }
    const mc: McInput = { start: { ...field, sets: callSets }, candidates: { [car]: own.candidates }, committed, hazard, rivalRules, config: { ...mcConfig, maxScenarioPolicies: cap } };
    return raceMonteCarlo(mc, rng, cap)[car] as McResult[CarId];
  };
  const bestOf = (r: McResult[CarId]): Policy => (r.rows[0] as McRow).policy;

  const results = new Map<CarId, McResult[CarId]>();
  if (ids.length === 1) {
    const car = ids[0] as CarId;
    results.set(car, plan(car));
  } else if (!anyCommitted) {
    const round1 = new Map(ids.map((car) => [car, plan(car)] as const));
    for (const car of ids) {
      const mate = other(car) as CarId;
      results.set(car, plan(car, { car: mate, fixed: bestOf(round1.get(mate) as McResult[CarId]) }));
    }
  } else {
    // the cars whose teammate committed first, against its commit; then the others against its best of that run
    const first = ids.filter((car) => cars.get(other(car) as CarId)?.followed !== null);
    for (const car of first) {
      const mate = other(car) as CarId;
      results.set(car, plan(car, { car: mate, fixed: cars.get(mate)?.followed as Policy }));
    }
    for (const car of ids.filter((c) => !first.includes(c))) {
      const mate = other(car) as CarId;
      results.set(car, plan(car, { car: mate, fixed: bestOf(results.get(mate) as McResult[CarId]) }));
    }
  }

  for (const car of ids) {
    const own = cars.get(car) as Car;
    const r = results.get(car) as McResult[CarId];
    const rows = r.rows.map((row): McRow => (row.committed ? { ...row, policy: own.original ?? row.policy, source: 'committed', infeasible: own.infeasible } : row));
    out[car] = known({ rows, scenarios: r.scenarios, capHit: r.capHit, candidates: own.candidates.length, hazard: hazardState, unresolvedTie: r.unresolvedTie }, s.at);
  }
  return out;
}
