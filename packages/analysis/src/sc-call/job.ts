// `sc-call`'s job module (SP4.3b spec §9.3; SP4.3b2 Task 9): `run` runs in a worker (C51). Per our car one DP solve
// (`strategy-dp`) and, per condition SC and VSC, boxing under it now against staying out, scored by `race-monte-carlo`'s
// `scoreCalls` on common scenarios to the flag. No state between runs (C31, C32).
//
// - Green: per condition one `scoreCalls` with the condition forced from now (its laps left by `race-hazard`'s duration
//   pmf), the DP queried under it (`under`); `floor(maxScenarioPolicies / 4)` scenarios each.
// - A neutralisation out: one run on it as it is (the DP's and the hazard's `active`), `floor(maxScenarioPolicies / 2)`
//   scenarios; the other condition's row `notApplicable`.
// - Box: the DP's best plan boxing at the car's start lap onto the best compound. Stay out: its best plan without a stop
//   through that lap, the DP's thresholds kept, the stay-out trigger last (it covers only the neutralisation out at the
//   start lap; a later one follows the thresholds, precondition 6, N3).
// - Per row: the mean places gained by boxing (stay − box finish), the share with box ahead, the places-gained bins;
//   `rejoin`'s position, loss and source (C43); the DP's trigger range of that condition for the next stop.
import { known, SC_CALL_GAIN_BINS, unknown, type CarId, type Known, type Policy, type ScCall, type ScCallRow, type StartingPoint, type Trigger } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { scoreCalls, type CallInput, type McInput } from '../race-monte-carlo/index.ts';
import { binShares } from '../shared/distribution.ts';
import { mcSettingsFrom, notPlannedWhy, plannedCars, plannedField, policyOf, strategyConfigOf, toDpInput, toMcHazard } from '../shared/strategy-input/index.ts';
import { bestWith, dpResult, solveDp, type DpSolution, type DpUnder } from '../strategy-dp/index.ts';
import { SC_CALL_CONFIG, type ScCallConfig } from './config.ts';
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

/** The first `neutralised` trigger of `condition` among the DP's thresholds: its lap range. */
function rangeOf(thresholds: readonly Trigger[], condition: ScCondition, at: number): ScCallRow['range'] {
  const t = thresholds.find((x): x is Extract<Trigger, { kind: 'neutralised' }> => x.kind === 'neutralised' && x.condition === condition);
  return t === undefined ? unknown('insufficientData') : known({ fromLap: t.fromLap, toLap: t.toLap }, at);
}

/** What one condition's run needs: the DP query's `under` (absent: the input's `active`) and the Monte Carlo hazard. */
type Under = { under: DpUnder | undefined; hazard: McInput['hazard'] };

/** One condition's row: the box and stay-out candidates scored on `scenarios` common scenarios. */
function rowOn(
  sol: DpSolution,
  thresholds: readonly Trigger[],
  call: { carId: CarId; lap: number; car: ScCallCar; condition: ScCondition; on: Under; scenarios: number; at: number },
  base: Omit<CallInput, 'candidates' | 'hazard' | 'scenarios'>,
  rng: Rng,
): ScCallRow {
  const { lap, car, condition, on, scenarios, at } = call;
  const box = bestWith(sol, { stopLap: lap, compound: 'best' }, on.under);
  const stay = bestWith(sol, { noStopThrough: lap }, on.under);
  if (box === null || stay === null || scenarios <= 0) return rowUnknown(car, condition, 'notApplicable');
  const stayOut: Trigger = { kind: 'neutralised', condition, fromLap: lap, toLap: lap, action: 'stayOut' };
  const boxPolicy: Policy = policyOf(box, thresholds);
  // the stay-out trigger last: the DP's thresholds act first, then it holds the car out under the forced one
  const stayPolicy: Policy = policyOf(stay, [...thresholds, stayOut]);
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
  return {
    condition,
    ePosDelta: known(sum / n, at),
    pGain: known(ahead / n, at),
    gainBins: known(binShares(diff, SC_CALL_GAIN_BINS), at),
    rejoinPosition: r.rejoinPosition,
    lossMs: r.lossMs,
    lossSource: r.lossSource,
    range: rangeOf(thresholds, condition, at),
  };
}

/** `sc-call`'s config of the run: its section over the defaults. */
const configOf = (config: ScCallInput['strategy']['config']): ScCallConfig => ({ ...SC_CALL_CONFIG.defaults, ...config[SC_CALL_CONFIG.key] }) as ScCallConfig;

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
  const sol = solveDp(dp);
  const { thresholds } = dpResult(sol);
  const cap = configOf(strategy.config).maxScenarioPolicies;
  // the call's car alone, or with a committed teammate as certain input; an uncommitted teammate is modelled like a rival
  const sets: StartingPoint['sets'] = { [carId]: field.sets[carId] ?? [] };
  const committed: Record<CarId, Policy | null> = { [carId]: null };
  for (const mate of strategy.ourCars) {
    const plan = strategy.committed[mate] ?? null;
    if (mate === carId || plan === null || field.sets[mate] === undefined) continue;
    sets[mate] = field.sets[mate];
    committed[mate] = plan;
  }
  const callStart: StartingPoint = { ...field, sets };
  const { rivalRules } = mcSettingsFrom(strategy.config);
  // the call reads no traffic outcome: the strategy config's gap, no traffic laps
  const base = { start: callStart, car: carId, committed, rivalRules, traffic: { gapMs: strategyConfigOf(strategy.config).trafficGapMs, laps: 0 } };
  const mcHazard = toMcHazard(hazard, callStart);
  const forced = (condition: ScCondition): Under => {
    const remaining = Float64Array.from(hazard.value.durationLaps[condition]);
    return { under: { condition, remaining }, hazard: { ...mcHazard, active: { condition, remaining: Float64Array.from(remaining) } } };
  };
  const rowFor = (condition: ScCondition, on: Under, scenarios: number): ScCallRow => rowOn(sol, thresholds, { carId, lap: dp.fromLap, car, condition, on, scenarios, at }, base, rng);

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
