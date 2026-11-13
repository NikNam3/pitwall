// `undercut`'s job module (SP4.3b spec §9.1): `run` runs in a worker (C51). Per our car one DP solve (`solveDp`), its
// cases against the rivals in range (`cases.ts`), scored by one `scoreCalls` on common scenarios under the cap of
// scenario-policies (a count, C2). Our other car is certain input following its committed plan, else modelled like a
// rival (as `strategy` plans a car alone). No state between runs (C31, C32).
import { known, unknown, type CarId, type Known, type Policy, type StartingPoint, type Trigger, type Undercut, type UndercutRival } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { scoreCalls, type CallInput } from '../race-monte-carlo/index.ts';
import { mcSettingsFrom, notPlannedWhy, toDpInput, toMcHazard } from '../shared/strategy-input/index.ts';
import { dpResult, solveDp, type DpSolution } from '../strategy-dp/index.ts';
import { caseValue, casesOf, ownStopsOf, rivalStopsOf, type CaseCall, type RivalStopsAt } from './cases.ts';
import type { UndercutCarInput, UndercutInput } from './prepare.ts';

export { prepareUndercut, type UndercutInput } from './prepare.ts';

/** The output: per our car its `undercut.car` value (`unknown(reason)` where the call does not apply); a rival is absent. */
export type UndercutOutput = Record<CarId, Known<Undercut>>;

/**
 * Traffic is no part of a case: one lap keeps the outcomes' read lines within the case's horizon (`scoreCalls` reads
 * our stop's next line, which `untilLap` covers).
 */
const TRAFFIC_LAPS = 1;

/** Our cars' DP solutions of one run, each solved once (C43: the one solve a car's cases and its turn as a rival share). */
type Solutions = (car: CarId) => { sol: DpSolution; thresholds: Trigger[] } | null;

function solutionsOf(input: UndercutInput, start: StartingPoint): Solutions {
  const solved = new Map<CarId, { sol: DpSolution; thresholds: Trigger[] } | null>();
  return (car) => {
    if (!solved.has(car)) {
      const sol = notPlannedWhy(input.strategy, start, car) === null ? solveDp(toDpInput(input.strategy, car)) : null;
      solved.set(car, sol === null ? null : { sol, thresholds: dpResult(sol).thresholds });
    }
    return solved.get(car) ?? null;
  };
}

/**
 * Our car `car`'s value on the known starting point `start`. A rival's stops are `rival-stops`' (precondition 5); our
 * other car as the rival boxes as its own DP plays it (it has no stop window of a rival).
 */
function carValue(input: UndercutInput, start: StartingPoint, at: number, car: CarId, own: UndercutCarInput, solutions: Solutions, rng: Rng): Undercut {
  const lap = startLapOf(start, car);
  const mine = solutions(car);
  const ours = new Set<number>(input.strategy.ourCars);
  const stopsOf = (k: CarId): RivalStopsAt => {
    if (!ours.has(k)) return rivalStopsOf(start, k);
    const theirs = solutions(k);
    return theirs === null ? () => null : ownStopsOf(theirs.sol);
  };
  const calls: CaseCall[] =
    mine === null ? [] : own.rivals.flatMap((rival) => casesOf(start, mine.sol, mine.thresholds, lap, rival, stopsOf(rival.carId), input.config.maxLapsLater));

  const outcomes = (() => {
    const scenarios = calls.length === 0 ? 0 : Math.floor(input.config.maxScenarioPolicies / calls.length);
    if (scenarios <= 0) return [];
    // the call's field: our car and, with a committed plan, our other car as certain input
    const sets: StartingPoint['sets'] = { [car]: start.sets[car] ?? [] };
    const committed: Record<CarId, Policy | null> = { [car]: null };
    for (const mate of input.strategy.ourCars) {
      const plan = input.strategy.committed[mate] ?? null;
      if (mate === car || plan === null || start.sets[mate] === undefined) continue;
      sets[mate] = start.sets[mate];
      committed[mate] = plan;
    }
    const call: CallInput = {
      start: { ...start, sets },
      car,
      candidates: calls.map((c) => c.candidate),
      committed,
      hazard: toMcHazard(input.strategy.hazard, start),
      rivalRules: mcSettingsFrom(input.strategy.config).rivalRules,
      scenarios,
      traffic: { gapMs: 0, laps: TRAFFIC_LAPS },
    };
    return scoreCalls(call, rng).outcomes;
  })();

  const rivals: UndercutRival[] = own.rivals.map((r) => {
    const gapMs = Math.abs(r.signedGapMs);
    return {
      carId: r.carId,
      side: r.side,
      position: r.position,
      gapMs,
      aheadFromGainMs: r.side === 'ahead' ? gapMs : -gapMs,
      cases: calls.flatMap((c, i) => (c.rival.carId === r.carId ? [caseValue(c, outcomes[i], own.greenRejoin, at)] : [])),
    };
  });
  return { carId: car, lap, position: own.position, rangeMs: input.config.undercutRangeMs, rivals };
}

/** Per our car the undercut cases (runs in a worker). */
export function run(input: UndercutInput, rng: Rng): UndercutOutput {
  const out: UndercutOutput = {};
  const s = input.strategy.start;
  const solutions = s.known ? solutionsOf(input, s.value) : () => null;
  for (const car of input.strategy.ourCars) {
    const own = input.cars[car];
    if (own === undefined || !own.applicable) {
      out[car] = unknown('notApplicable');
      continue;
    }
    if (!s.known) {
      out[car] = unknown(s.reason);
      continue;
    }
    const why = notPlannedWhy(input.strategy, s.value, car);
    out[car] = why === null ? known(carValue(input, s.value, s.at, car, own, solutions, rng), s.at) : unknown(why);
  }
  return out;
}
