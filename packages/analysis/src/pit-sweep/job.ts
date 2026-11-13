// `pit-sweep`'s job module (SP4.3b spec §9.2): `run` runs in a worker (C51). No state between runs (C31, C32).
//
// Per our car one DP solve (`solveDp(toDpInput(...))`, the shared strategy input, C43); per compound with a new set and
// per stop lap L from `max(now, window.from − rowsBefore)` (now: the DP's `fromLap`, at least the leader's lap, where
// `scoreCalls` plays our stops from) to `min(flag − 1, window.to + rowsAfter)`, the window being the compound's
// `pit-window` `windowLaps` (every stop lap from now to `flag − 1` while it is unknown, Task 18q B), the candidate "box
// at L onto the compound, then the DP's best continuation"
// (`policyOf(bestWith(...), thresholds)`, to the flag); one `scoreCalls` per compound on common scenarios,
// `floor(maxScenarioPolicies / rows)` each (a count, C2). A stop lap whose `bestWith` is `null` has no row; a compound
// without a row is absent. The car is the call's only car of ours, with a committed teammate as certain input (as far
// as it can follow its plan) and an uncommitted one modelled like a rival, as `strategy`'s final call does.
import { known, unknown, type CarId, type Known, type PitSweepCar, type PitSweepTable, type Policy, type SessionTime, type StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { scoreCalls, type CallCandidate } from '../race-monte-carlo/index.ts';
import { committedField, mcSettingsFrom, notPlannedWhy, plannedCars, plannedField, policyOf, toDpInput, toMcHazard } from '../shared/strategy-input/index.ts';
import { bestWith, dpResult, solveDp } from '../strategy-dp/index.ts';
import type { PitSweepInput, SweepCar } from './prepare.ts';
import { rowsOf } from './rows.ts';

export type { PitSweepInput } from './prepare.ts';

/** The output: per our car its sweep of every compound with a new set; a rival is absent. */
export type PitSweepOutput = Record<CarId, PitSweepCar>;

/** The call's field for car `car`: only its sets, and a committed teammate's with its followable plan (`committedField`, C43). */
function callField(input: PitSweepInput, field: StartingPoint, car: CarId): { start: StartingPoint; committed: Record<CarId, Policy | null> } {
  const sets: StartingPoint['sets'] = { [car]: field.sets[car] ?? [] };
  const mates = committedField(input.strategy, car);
  for (const mate of Object.keys(mates).map((k) => Number(k) as CarId)) sets[mate] = field.sets[mate] ?? [];
  return { start: { ...field, sets }, committed: { [car]: null, ...mates } };
}

/** A compound's stop laps `[first, last]` from `now`: around its window by `rowsBefore` and `rowsAfter`, else every stop lap to `flag − 1` (Task 18q B). */
function rowRange(now: number, flag: number, window: Known<{ from: number; to: number }> | undefined, config: PitSweepInput['config']): [number, number] {
  if (window === undefined || !window.known) return [now, flag - 1];
  return [Math.max(now, window.value.from - config.rowsBefore), Math.min(flag - 1, window.value.to + config.rowsAfter)];
}

/** Car `car`'s tables, one per compound that has a row. */
function tablesOf(input: PitSweepInput, start: StartingPoint, at: SessionTime, car: CarId, c: SweepCar, position: number, rng: Rng): PitSweepCar['byCompound'] {
  const { strategy, config } = input;
  const field = plannedField(start, plannedCars(strategy, start));
  const solution = solveDp(toDpInput(strategy, car));
  const thresholds = dpResult(solution).thresholds;
  const now = solution.input.fromLap;
  const flag = c.flag.known ? c.flag.value : start.lapsTotal;
  const { start: callStart, committed } = callField(input, field, car);
  const hazard = toMcHazard(strategy.hazard, field);
  const { rivalRules, zTie, tieBand } = mcSettingsFrom(strategy.config);

  const byCompound: PitSweepCar['byCompound'] = {};
  for (const compound of c.compounds) {
    const stopLaps: number[] = [];
    const candidates: CallCandidate[] = [];
    // `scoreCalls` plays our stops from the leader's lap on: a car still on the lap before has no row for it
    const [first, last] = rowRange(Math.max(now, start.lap), flag, c.windows[compound], config);
    for (let lap = first; lap <= last; lap++) {
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

/** Car `car`'s parts: one per compound, its `compounds` and `windows` cut to it; one, the car whole, where it sweeps none
 * (ruled out by the behaviour table, or without a compound). */
function partsOf(input: PitSweepInput, car: CarId): PitSweepInput[] {
  const c = input.cars[car] as SweepCar;
  if (!c.applies || c.compounds.length === 0) return [{ ...input, cars: { [car]: c } }];
  return c.compounds.map((compound) => {
    const window = c.windows[compound];
    const cut: SweepCar = { ...c, compounds: [compound], windows: window === undefined ? {} : { [compound]: window } };
    return { ...input, cars: { [car]: cut } };
  });
}

/** The job's parts (C51, Task 18q A): one per (our car with a `cars` entry, compound), in our cars' and their compounds'
 * order; the input as it is when there is no car. The shared strategy input and the config stay whole. Each part draws
 * the generator as the whole run does for its car and compound, so the parts in sequence equal a run without parts. */
export function splitPitSweep(input: PitSweepInput): PitSweepInput[] {
  const cars = input.strategy.ourCars.filter((car) => input.cars[car] !== undefined);
  return cars.length === 0 ? [input] : cars.flatMap((car) => partsOf(input, car));
}

/** The parts' outputs joined per car: its head (lap, position, auto) from its first part, `byCompound` from all, in order. */
export function mergePitSweep(outs: readonly PitSweepOutput[]): PitSweepOutput {
  const merged: PitSweepOutput = {};
  for (const out of outs) {
    for (const car of Object.keys(out).map((k) => Number(k) as CarId)) {
      const part = out[car] as PitSweepCar;
      const seen = merged[car];
      merged[car] = seen === undefined ? part : { ...seen, byCompound: { ...seen.byCompound, ...part.byCompound } };
    }
  }
  return merged;
}

/** Per our car one table per compound (runs in a worker). */
export function run(input: PitSweepInput, rng: Rng): PitSweepOutput {
  const out: PitSweepOutput = {};
  for (const car of input.strategy.ourCars) if (input.cars[car] !== undefined) out[car] = sweepOf(input, car, rng);
  return out;
}
