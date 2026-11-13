// The DP's input from the strategy input (SP4.3b spec §6, §8.1; moved from `strategy/job.ts`, SP4.3b2 Task 6): the field
// the job plans (our cars not planned modelled like rivals), `race-hazard`'s tables per lap, the plain forecast's road
// and the traffic cost of a rejoin per lap. Pure (C2).
import { NOISE_COMPOUNDS, type CarId, type NoiseCompound, type Policy, type RaceHazard, type StartingPoint } from '@pitwall/domain';
import { createRng, type Rng } from '@pitwall/engine/readers';
import { raceForecast, startLapOf } from '../../race-forecast/index.ts';
import { rivalNextCompound, type McInput } from '../../race-monte-carlo/index.ts';
import type { DpInput } from '../../strategy-dp/index.ts';
import type { StrategyInput } from './input.ts';
import { strategyConfigOf } from './settings.ts';

type Hazard = McInput['hazard'];

/** Why the job does not plan car `car`, or `null` when it does: by the behaviour table, running, in the field, with its sets known and a lap left to plan. */
export function notPlannedWhy(input: StrategyInput, start: StartingPoint, car: CarId): 'notApplicable' | 'insufficientData' | null {
  const applicable = input.planned.includes(car) && car < start.cars && start.retired[car] !== 1 && startLapOf(start, car) <= start.lapsTotal;
  if (!applicable) return 'notApplicable';
  return start.sets[car] === undefined ? 'insufficientData' : null;
}

/** The field the job plans: the starting point with only the planned cars' sets (a car of ours not planned is modelled like a rival). */
export function plannedField(start: StartingPoint, planned: Iterable<CarId>): StartingPoint {
  const sets: StartingPoint['sets'] = {};
  for (const car of planned) sets[car] = start.sets[car] ?? [];
  return { ...start, sets };
}

/** `race-hazard`'s tables per lap from the leader's lap (index 0 = `start.lap`); without them, no neutralisation drawn. */
export function hazardOf(start: Pick<StartingPoint, 'lap' | 'lapsTotal'>, hazard: RaceHazard): Hazard {
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
export type PlainRoad = Map<number, { gapMs: Float64Array; position: Int8Array }>;

/** The plain forecast's road; it draws one seed from `rng`, which a plain scenario's noise never reads. */
export function plainRoad(start: StartingPoint, rng: Rng): PlainRoad {
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
function trafficOf(start: StartingPoint, road: PlainRoad, car: CarId, fromLap: number, trafficGapMs: number): Float64Array {
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

/** The DP's input for car `car` of the planned field `field` from its lap on (spec §6), the road and hazard given. */
export function dpInputOn(field: StartingPoint, car: CarId, hazard: Hazard, road: PlainRoad, trafficGapMs: number): DpInput {
  const fromLap = startLapOf(field, car);
  const n = field.lapsTotal - fromLap + 1;
  const shifted = (a: Float64Array): Float64Array => Float64Array.from({ length: n }, (_, i) => a[fromLap + i - field.lap] ?? 0);
  const rate = field.wearRatePct[car] ?? 0;
  const wearRatePct = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, rate])) as Record<NoiseCompound, number>;
  // new sets only (spec §6, K5)
  const sets = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, 0])) as Record<NoiseCompound, number>;
  for (const s of field.sets[car] ?? []) if (s.wearPct <= 0) sets[s.compound] += 1;
  return {
    car,
    fromLap,
    totalLaps: field.lapsTotal,
    lap: field.lapModel,
    carParams: {
      compound: NOISE_COMPOUNDS[field.compound[car] ?? 1] ?? 'medium',
      tyreAge: field.tyreAge[car] ?? 0,
      wearPct: field.wearPct[car] ?? 0,
      fuelKg: field.fuelKg[car] ?? 0,
      paceMs: field.paceMs[car] ?? 0,
      degMsPerLap: field.degMsPerLap[car] ?? 0,
      wearRatePct,
      human: field.human[car] === 1,
    },
    sets,
    owesSecondCompound: field.owesStop[car] === 1,
    pitLossMs: field.track.pitLossMs,
    hazard: { byLap: shifted(hazard.byLap), vscByLap: shifted(hazard.vscByLap), scDur: hazard.scDur, vscDur: hazard.vscDur },
    active: hazard.active,
    wetnessByLap: new Float64Array(n).fill(field.wetness.wetnessMs),
    trafficMsByLap: trafficOf(field, road, car, fromLap, trafficGapMs),
  };
}

/** The planned cars of `input` on its known starting point `start`. */
export function plannedCars(input: StrategyInput, start: StartingPoint): CarId[] {
  return input.ourCars.filter((car) => notPlannedWhy(input, start, car) === null);
}

/**
 * Car `car`'s DP input as the job builds it (spec §6, §8.1): on the planned field, with the hazard and the plain
 * forecast's traffic. The plain forecast's noise reads no draw, so its seed here is fixed.
 */
export function toDpInput(input: StrategyInput, car: CarId): DpInput {
  if (!input.start.known) throw new Error(`toDpInput: car ${car} has no starting point (${input.start.reason})`);
  const field = plannedField(input.start.value, plannedCars(input, input.start.value));
  return dpInputOn(field, car, hazardOf(field, input.hazard), plainRoad(field, createRng(0)), strategyConfigOf(input.config).trafficGapMs);
}
