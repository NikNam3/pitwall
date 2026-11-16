// `sc-call`'s job module (SP4.3b spec §9.3; SP4.3b2 Task 9): `run` runs in a worker (C51). Per our car one DP solve
// (`strategy-dp`) and, per condition SC and VSC, boxing under it now against staying out, scored by `race-monte-carlo`'s
// `scoreCalls` on common scenarios to the flag. No state between runs (C31, C32).
//
// - Green: per condition one `scoreCalls` with the condition forced from now (its laps left by `race-hazard`'s duration
//   pmf), the DP queried under it (`under`); `floor(maxScenarioPolicies / 4)` scenarios each.
// - A neutralisation out: one run on it as it is (the DP's and the hazard's `active`), `floor(maxScenarioPolicies / 2)`
//   scenarios; the other condition's row `notApplicable`.
// - Box: the DP's best plan boxing at the car's start lap onto the best compound. Stay out: its best plan without a stop
//   through that lap. Each a stop list (SP4.3d spec §5.1).
// - Per row: the mean places gained by boxing (stay − box finish), the share with box ahead, the places-gained bins;
//   `rejoin`'s position, loss and source (C43); `range` `notApplicable` (no trigger ranges since §5.1).
import { known, SC_CALL_GAIN_BINS, unknown, type CarId, type Known, type Policy, type ScCall, type ScCallRow, type StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { scoreCalls, type CallInput, type McInput } from '../race-monte-carlo/index.ts';
import { configOf } from '../shared/config-of.ts';
import { binShares } from '../shared/distribution.ts';
import { lowerMedian } from '../shared/stats.ts';
import { committedField, mcSettingsFrom, notPlannedWhy, plannedCars, plannedField, policyOf, reactionsOf, strategyConfigOf, toDpInput, toMcHazard } from '../shared/strategy-input/index.ts';
import { bestWith, solveWorld, type DpSolution, type DpUnder } from '../strategy-dp/index.ts';
import { SC_CALL_CONFIG } from './config.ts';
import type { ScCallCar, ScCallInput, ScCondition } from './prepare.ts';

export type { ScCallInput } from './prepare.ts';

/** The output: per our car its `scCall.car` value (both rows `unknown(reason)` where the call does not apply); a rival is absent. */
export type ScCallOutput = Record<CarId, ScCall>;

type Reason = Extract<Known<never>, { known: false }>['reason'];

const CONDITIONS = ['sc', 'vsc'] as const satisfies readonly ScCondition[];

/** A row with every `Known` `unknown(reason)`; the loss source as `rejoin` gave it. */
function rowUnknown(car: ScCallCar, condition: ScCondition, reason: Reason): ScCallRow {
  const u = unknown(reason);
  return { condition, ePosDelta: u, pGain: u, gainBins: u, rejoinPosition: u, lossMs: u, lossSource: car.rejoin[condition].lossSource, range: u };
}

/** Both rows `unknown(reason)`. */
const callUnknown = (carId: CarId, lap: number, car: ScCallCar, reason: Reason): ScCall => ({
  carId,
  lap,
  rows: [rowUnknown(car, 'sc', reason), rowUnknown(car, 'vsc', reason)],
});

/** What one condition's run needs: the DP query's `under` (absent: the input's `active`) and the Monte Carlo hazard. */
type Under = { under: DpUnder | undefined; hazard: McInput['hazard'] };

/** One condition's row: the box and stay-out candidates scored on `scenarios` common scenarios. */
function rowOn(
  sol: DpSolution,
  call: { carId: CarId; lap: number; car: ScCallCar; condition: ScCondition; on: Under; scenarios: number; at: number },
  base: Omit<CallInput, 'candidates' | 'hazard' | 'scenarios'>,
  rng: Rng,
): ScCallRow {
  const { lap, car, condition, on, scenarios, at } = call;
  const box = bestWith(sol, { stopLap: lap, compound: 'best' }, on.under);
  const stay = bestWith(sol, { noStopThrough: lap }, on.under);
  if (box === null || stay === null || scenarios <= 0) return rowUnknown(car, condition, 'notApplicable');
  const boxPolicy: Policy = policyOf(box);
  // every stop of the stay-out plan lies after the start lap (`noStopThrough`)
  const stayPolicy: Policy = policyOf(stay);
  const { outcomes } = scoreCalls(
    {
      ...base,
      hazard: on.hazard,
      scenarios,
      candidates: [
        { policy: boxPolicy, rival: null, untilLap: null },
        { policy: stayPolicy, rival: null, untilLap: null },
      ],
    },
    rng,
  );
  const [boxOut, stayOutcome] = outcomes;
  if (boxOut === undefined || stayOutcome === undefined) throw new Error('sc-call: scoreCalls gave no outcome per candidate');
  const n = boxOut.finish.length;
  const diff = new Float64Array(n);
  let sum = 0;
  let ahead = 0;
  for (let i = 0; i < n; i++) {
    const b = boxOut.finish[i] ?? 0;
    const s = stayOutcome.finish[i] ?? 0;
    diff[i] = s - b;
    sum += s - b;
    if (b < s) ahead++;
  }
  const r = car.rejoin[condition];
  // the box run's simulated rejoin, its median over the scenarios that stopped: the one stop-and-rejoin model's, as the
  // row's ePosDelta and pGain come from those runs (SP4.3c Task 17, B8)
  const rejoinMedian = lowerMedian(Array.from(boxOut.rejoin).filter((p) => p > 0));
  return {
    condition,
    ePosDelta: known(sum / n, at),
    pGain: known(ahead / n, at),
    gainBins: known(binShares(diff, SC_CALL_GAIN_BINS), at),
    rejoinPosition: rejoinMedian === undefined ? unknown('insufficientData') : known(rejoinMedian, at),
    lossMs: r.lossMs,
    lossSource: r.lossSource,
    // no trigger range since plans are stop lists (SP4.3d spec §5.1); Task 6 replaces the type
    range: unknown('notApplicable'),
  };
}

/** Car `carId`'s call on the known starting point `start`. */
function callFor(input: ScCallInput, start: StartingPoint, at: number, carId: CarId, car: ScCallCar, rng: Rng): ScCall {
  const { strategy } = input;
  const field = plannedField(start, plannedCars(strategy, start));
  const lap = startLapOf(field, carId);
  if (car.effect === 'notApplicable' || car.boxedUnder) return callUnknown(carId, lap, car, 'notApplicable');
  const why = notPlannedWhy(strategy, start, carId);
  if (why !== null) return callUnknown(carId, lap, car, why);
  const hazard = strategy.hazard;
  if (!hazard.known) return callUnknown(carId, lap, car, hazard.reason);

  const dp = toDpInput(strategy, carId);
  // the first weather world's solve (the heaviest, `toDpInput`'s order); Task 20 selects across worlds
  const sol = solveWorld(dp, 0);
  const cap = configOf(SC_CALL_CONFIG, strategy).maxScenarioPolicies;
  // the call's car alone, or with a committed teammate as certain input; an uncommitted teammate is modelled like a rival
  const sets: StartingPoint['sets'] = { [carId]: field.sets[carId] ?? [] };
  const mates = committedField(strategy, carId);
  for (const mate of Object.keys(mates).map((k) => Number(k) as CarId)) sets[mate] = field.sets[mate] ?? [];
  const committed: Record<CarId, Policy | null> = { [carId]: null, ...mates };
  const callStart: StartingPoint = { ...field, sets };
  const { rivalRules } = mcSettingsFrom(strategy.config);
  // the call reads no traffic outcome: the strategy config's gap, no traffic laps
  // our cars' SC/VSC reaction to a later neutralisation (spec §5.2): the car's from its solve, a committed teammate's from its own
  const reactions = reactionsOf(strategy, start, Object.keys(sets).map((k) => Number(k) as CarId), (k) => (k === carId ? sol : null));
  const base = { start: callStart, car: carId, committed, rivalRules, traffic: { gapMs: strategyConfigOf(strategy.config).trafficGapMs, laps: 0 }, reactions };
  const mcHazard = toMcHazard(hazard, callStart);
  const forced = (condition: ScCondition): Under => {
    const remaining = Float64Array.from(hazard.value.durationLaps[condition]);
    return { under: { condition, remaining }, hazard: { ...mcHazard, active: { condition, remaining: Float64Array.from(remaining) } } };
  };
  const rowFor = (condition: ScCondition, on: Under, scenarios: number): ScCallRow => rowOn(sol, { carId, lap: dp.fromLap, car, condition, on, scenarios, at }, base, rng);

  const out = input.neutralised;
  if (out === null) {
    const scenarios = Math.floor(cap / 4);
    return { carId, lap: dp.fromLap, rows: [rowFor('sc', forced('sc'), scenarios), rowFor('vsc', forced('vsc'), scenarios)] };
  }
  // a neutralisation out: its run as it is; without race-hazard's `active` yet, forced from now as under green
  const real: Under = mcHazard.active?.condition === out ? { under: undefined, hazard: mcHazard } : forced(out);
  const rows = CONDITIONS.map((c) => (c === out ? rowFor(c, real, Math.floor(cap / 2)) : rowUnknown(car, c, 'notApplicable'))) as ScCall['rows'];
  return { carId, lap: dp.fromLap, rows };
}

/** Per our car the SC and VSC rows (runs in a worker); every car of ours present, a rival absent. */
export function run(input: ScCallInput, rng: Rng): ScCallOutput {
  const out: ScCallOutput = {};
  const s = input.strategy.start;
  for (const carId of input.strategy.ourCars) {
    const car = input.cars[carId];
    if (car === undefined) continue;
    if (!s.known) {
      out[carId] = callUnknown(carId, car.lap, car, car.effect === 'notApplicable' ? 'notApplicable' : s.reason);
      continue;
    }
    out[carId] = callFor(input, s.value, s.at, carId, car, rng);
  }
  return out;
}
