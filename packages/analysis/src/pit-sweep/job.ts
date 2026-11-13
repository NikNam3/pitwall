// `pit-sweep`'s job module (SP4.3b spec §9.2): `run` runs in a worker (C51). No state between runs (C31, C32).
//
// Per our car one DP solve (`solveDp(toDpInput(...))`, the shared strategy input, C43); per compound with a new set and
// per stop lap L from now (the DP's `fromLap`, at least the leader's lap, where `scoreCalls` plays our stops from) to `min(flag − 1, stint.latest + pastLifeLaps)` (`flag − 1` while
// `stint.latest` is unknown) the candidate "box at L onto the compound, then the DP's best continuation"
// (`policyOf(bestWith(...), thresholds)`, to the flag); one `scoreCalls` per compound on common scenarios,
// `floor(maxScenarioPolicies / rows)` each (a count, C2). A stop lap whose `bestWith` is `null` has no row; a compound
// without a row is absent. The car is the call's only car of ours, with a committed teammate as certain input (as far
// as it can follow its plan) and an uncommitted one modelled like a rival, as `strategy`'s final call does.
import { known, unknown, type CarId, type PitSweepCar, type PitSweepTable, type Policy, type SessionTime, type StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { scoreCalls, type CallCandidate } from '../race-monte-carlo/index.ts';
import { mcSettingsFrom, notPlannedWhy, plannedCars, plannedField, policyOf, toDpInput, toMcHazard } from '../shared/strategy-input/index.ts';
import { bestWith, dpResult, solveDp } from '../strategy-dp/index.ts';
import { followable } from '../strategy/job.ts';
import type { PitSweepInput, SweepCar } from './prepare.ts';
import { rowsOf } from './rows.ts';

export type { PitSweepInput } from './prepare.ts';

/** The output: per our car its sweep of every compound with a new set; a rival is absent. */
export type PitSweepOutput = Record<CarId, PitSweepCar>;

/** The call's field for car `car`: only its sets, and a committed teammate's with its followable plan. */
function callField(input: PitSweepInput, field: StartingPoint, car: CarId): { start: StartingPoint; committed: Record<CarId, Policy | null> } {
  const sets: StartingPoint['sets'] = { [car]: field.sets[car] ?? [] };
  const committed: Record<CarId, Policy | null> = { [car]: null };
  for (const mate of input.strategy.ourCars) {
    const plan = input.strategy.committed[mate] ?? null;
    if (mate === car || plan === null || field.sets[mate] === undefined) continue;
    sets[mate] = field.sets[mate];
    committed[mate] = followable(field, mate, plan).policy;
  }
  return { start: { ...field, sets }, committed };
}

/** Car `car`'s tables, one per compound that has a row. */
function tablesOf(input: PitSweepInput, start: StartingPoint, at: SessionTime, car: CarId, c: SweepCar, position: number, rng: Rng): PitSweepCar['byCompound'] {
  const { strategy, config } = input;
  const field = plannedField(start, plannedCars(strategy, start));
  const solution = solveDp(toDpInput(strategy, car));
  const thresholds = dpResult(solution).thresholds;
  const now = solution.input.fromLap;
  const flag = c.flag.known ? c.flag.value : start.lapsTotal;
  const last = c.latest.known ? Math.min(flag - 1, c.latest.value + config.pastLifeLaps) : flag - 1;
  const { start: callStart, committed } = callField(input, field, car);
  const hazard = toMcHazard(strategy.hazard, field);
  const { rivalRules, zTie, tieBand } = mcSettingsFrom(strategy.config);

  const byCompound: PitSweepCar['byCompound'] = {};
  for (const compound of c.compounds) {
    const stopLaps: number[] = [];
    const candidates: CallCandidate[] = [];
    // `scoreCalls` plays our stops from the leader's lap on: a car still on the lap before has no row for it
    for (let lap = Math.max(now, start.lap); lap <= last; lap++) {
      const plan = bestWith(solution, { stopLap: lap, compound });
      if (plan === null) continue;
      stopLaps.push(lap);
      candidates.push({ policy: policyOf(plan, thresholds), rival: null, untilLap: null });
    }
    if (candidates.length === 0) continue;
    const scenarios = Math.max(1, Math.floor(config.maxScenarioPolicies / candidates.length));
    const traffic = { gapMs: config.trafficGapMs, laps: config.trafficLaps };
    const { outcomes } = scoreCalls({ start: callStart, car, candidates, committed, hazard, rivalRules, scenarios, traffic }, rng);
    const rows = rowsOf(stopLaps, outcomes, { now, position, cars: callStart.cars, latest: c.latest, greenRejoin: c.greenRejoin, zTie, tieBand, at });
    if (rows.length === 0) continue;
    const table: PitSweepTable = { compound, rows, scenarios };
    byCompound[compound] = known(table, at);
  }
  return byCompound;
}

/** Car `car`'s sweep: `notApplicable` by the behaviour table; no tables where the car cannot be planned. */
function sweepOf(input: PitSweepInput, car: CarId, rng: Rng): PitSweepCar {
  const c = input.cars[car] as SweepCar;
  const s = input.strategy.start;
  const lap = s.known ? startLapOf(s.value, car) : c.lap;
  // the live position at the trigger; a car without one counts as last
  const position = input.strategy.positions[car] ?? (s.known ? s.value.cars : 1);
  const head = { carId: car, lap, position };
  if (!c.applies) return { ...head, auto: unknown('notApplicable'), byCompound: {} };
  if (!s.known || notPlannedWhy(input.strategy, s.value, car) !== null) return { ...head, auto: c.auto, byCompound: {} };
  return { ...head, auto: c.auto, byCompound: tablesOf(input, s.value, s.at, car, c, position, rng) };
}

/** Per our car one table per compound (runs in a worker). */
export function run(input: PitSweepInput, rng: Rng): PitSweepOutput {
  const out: PitSweepOutput = {};
  for (const car of input.strategy.ourCars) if (input.cars[car] !== undefined) out[car] = sweepOf(input, car, rng);
  return out;
}
