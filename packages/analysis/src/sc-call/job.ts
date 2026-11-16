// `sc-call`'s job module (SP4.3d spec §6.3; SP4.3d1 Task 6): `run` runs in a worker (C51). Per our car one DP solve
// (`strategy-dp`) and, per condition, the six answers stay out and box S, M, H, I, W, scored by `race-monte-carlo`'s
// `scoreCalls` on common scenarios to the flag, with our SC/VSC reaction to later neutralisations (spec §5.2). No state
// between runs (C31, C32).
//
// - Green running: three blocks, SC and VSC each forced from now (its laps left by `race-hazard`'s duration pmf, the DP
//   queried under it, `under`) and GREEN (no neutralisation out, the DP queried without `under`, as `pit-sweep`).
// - A neutralisation out: its block only, on it as it is (the DP's and the hazard's `active`).
// - Box X: `bestWith(solution, { stopLap: lap, compound: X }, under)`, the DP's one answer to "the best plan with this
//   stop" (C43, the one `pit-sweep` plays); a compound without a set left `unknown('noSet')`. Stay: the committed plan
//   as far as the car can follow it, else the DP's best plan without a stop through the lap.
// - Per block one `scoreCalls`, `floor(maxScenarioPolicies / blocks / candidates)` scenarios (a count, C2). Per option
//   E[pos], its Monte Carlo error, the position pmf; ΔPOS (stay − option) and P(gain) (the option finishes ahead of
//   staying out) on the common scenarios; the rejoin position, the loss and its source from `rejoin` (C43).
import { known, unknown, type CarId, type Known, type NoiseCompound, type PitCondition, type Policy, type ScCallAnswer, type ScCallBlock, type ScCallBlocks, type ScCallOption, type StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { startLapOf } from '../race-forecast/index.ts';
import { scoreCalls, type CallCandidate, type CallInput, type McInput } from '../race-monte-carlo/index.ts';
import { configOf } from '../shared/config-of.ts';
import { placePmf } from '../shared/distribution.ts';
import { committedField, followable, mcSettingsFrom, notPlannedWhy, plannedCars, plannedField, policyOf, reactionsOf, strategyConfigOf, toDpInput, toMcHazard } from '../shared/strategy-input/index.ts';
import { bestWith, solveWorld, type DpSolution, type DpUnder } from '../strategy-dp/index.ts';
import { SC_CALL_CONFIG } from './config.ts';
import type { ScCallCar, ScCallInput, ScCondition } from './prepare.ts';

export type { ScCallInput } from './prepare.ts';

/** The output: per our car its `scCall.car` value (no block where the call does not apply); a rival is absent. */
export type ScCallOutput = Record<CarId, ScCallBlocks>;

type Reason = Extract<Known<never>, { known: false }>['reason'];
type Box = Exclude<ScCallAnswer, 'stay'>;

/** The answers in the card's order (spec §6.3). */
const ANSWERS = ['stay', 'S', 'M', 'H', 'I', 'W'] as const satisfies readonly ScCallAnswer[];
const COMPOUND_OF: Record<Box, NoiseCompound> = { S: 'soft', M: 'medium', H: 'hard', I: 'inter', W: 'wet' };

/** One option with every `Known` `unknown(reason)`. */
function optionUnknown(answer: ScCallAnswer, reason: Reason): ScCallOption {
  const u = unknown(reason);
  return { answer, ePos: u, se: u, ePosDelta: u, pGain: u, rejoinPosition: u, positionPmf: u };
}

/** A block whose every option and loss is `unknown(reason)`; the loss source as `rejoin` gave it. */
function blockUnknown(car: ScCallCar, condition: PitCondition, reason: Reason): ScCallBlock {
  const u = unknown(reason);
  return { condition, options: ANSWERS.map((a) => optionUnknown(a, reason)), lossMs: u, lossSource: car.rejoin[condition].lossSource, lapsLeft: u };
}

/** The conditions of the blocks: the one out, else SC, VSC and GREEN. */
const conditionsOf = (out: ScCondition | null): PitCondition[] => (out === null ? ['sc', 'vsc', 'green'] : [out]);

/** The value of a car whose call cannot be computed for `reason`: its blocks, every `Known` `unknown(reason)`. */
const callUnknown = (input: ScCallInput, carId: CarId, lap: number, car: ScCallCar, reason: Reason): ScCallBlocks => ({
  carId,
  lap,
  out: input.neutralised,
  blocks: conditionsOf(input.neutralised).map((c) => blockUnknown(car, c, reason)),
});

/** The expected laps of a pmf over 1, 2, 3 … laps (index 0 = 1 lap); unknown without mass. */
function expectedLaps(pmf: readonly number[], at: number): Known<number> {
  let mass = 0;
  let sum = 0;
  pmf.forEach((p, i) => {
    mass += p;
    sum += p * (i + 1);
  });
  return mass > 0 ? known(sum / mass, at) : unknown('insufficientData');
}

const meanOf = (xs: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i] ?? 0;
  return s / xs.length;
};

/** The Monte Carlo error of the mean of `xs` (its sample standard deviation over √n). */
function seOf(xs: ArrayLike<number>, mean: number): number {
  let v = 0;
  for (let i = 0; i < xs.length; i++) v += ((xs[i] ?? 0) - mean) ** 2;
  return Math.sqrt(v / Math.max(1, xs.length - 1) / xs.length);
}

/** What one block's run needs: the DP query's `under` (absent: the input's `active` or none), the hazard, laps left. */
type Under = { under: DpUnder | undefined; hazard: McInput['hazard']; lapsLeft: Known<number> };

/** What every block of one car's call reads. */
type CallContext = {
  sol: DpSolution;
  lap: number;
  car: ScCallCar;
  /** The compounds the car has a set of. */
  sets: ReadonlySet<NoiseCompound>;
  /** The committed plan as far as the car can follow it, else `null`. */
  committed: Policy | null;
  cars: number;
  at: number;
  base: Omit<CallInput, 'candidates' | 'hazard' | 'scenarios'>;
};

/** One condition's block: stay and every box answer with a set, scored on common scenarios within `budget` scenario-policies. */
function blockOn(ctx: CallContext, condition: PitCondition, on: Under, budget: number, rng: Rng): ScCallBlock {
  const { sol, lap, car, at } = ctx;
  const r = car.rejoin[condition];
  const head = { condition, lossMs: r.lossMs, lossSource: r.lossSource, lapsLeft: on.lapsLeft };
  const stayPlan = ctx.committed ?? (() => {
    const p = bestWith(sol, { noStopThrough: lap }, on.under);
    return p === null ? null : policyOf(p);
  })();
  const options = new Map<ScCallAnswer, ScCallOption>();
  const played: { answer: ScCallAnswer; policy: Policy }[] = [];
  if (stayPlan === null) options.set('stay', optionUnknown('stay', 'notApplicable'));
  else played.push({ answer: 'stay', policy: stayPlan });
  for (const answer of ANSWERS) {
    if (answer === 'stay') continue;
    const compound = COMPOUND_OF[answer];
    if (!ctx.sets.has(compound)) {
      options.set(answer, optionUnknown(answer, 'noSet'));
      continue;
    }
    const plan = bestWith(sol, { stopLap: lap, compound }, on.under);
    if (plan === null) options.set(answer, optionUnknown(answer, 'notApplicable'));
    else played.push({ answer, policy: policyOf(plan) });
  }
  const scenarios = played.length === 0 ? 0 : Math.floor(budget / played.length);
  if (scenarios <= 0) return { ...head, options: ANSWERS.map((a) => options.get(a) ?? optionUnknown(a, 'notApplicable')) };

  const candidates: CallCandidate[] = played.map(({ policy }) => ({ policy, rival: null, untilLap: null }));
  const { outcomes } = scoreCalls({ ...ctx.base, hazard: on.hazard, scenarios, candidates }, rng);
  const finishes = played.map((_, i) => {
    const o = outcomes[i];
    if (o === undefined) throw new Error('sc-call: scoreCalls gave no outcome per candidate');
    return o.finish;
  });
  const stayFinish = stayPlan === null ? undefined : finishes[0];
  const stayMean = stayFinish === undefined || stayFinish.length === 0 ? undefined : meanOf(stayFinish);
  played.forEach(({ answer }, i) => {
    const finish = finishes[i] as Int8Array;
    if (finish.length === 0) {
      options.set(answer, optionUnknown(answer, 'insufficientData'));
      return;
    }
    const ePos = meanOf(finish);
    const isStay = answer === 'stay';
    let ahead = 0;
    if (!isStay && stayFinish !== undefined) for (let k = 0; k < finish.length; k++) if ((finish[k] ?? 0) < (stayFinish[k] ?? 0)) ahead++;
    const againstStay = !isStay && stayMean !== undefined;
    options.set(answer, {
      answer,
      ePos: known(ePos, at),
      se: known(seOf(finish, ePos), at),
      ePosDelta: againstStay ? known(stayMean - ePos, at) : unknown('notApplicable'),
      pGain: againstStay ? known(ahead / finish.length, at) : unknown('notApplicable'),
      // staying out keeps our place now; a stop rejoins where `rejoin` puts it under this condition (C43)
      rejoinPosition: isStay ? (car.position === null ? unknown('insufficientData') : known(car.position, at)) : r.rejoinPosition,
      positionPmf: known(placePmf(finish, ctx.cars), at),
    });
  });
  return { ...head, options: ANSWERS.map((a) => options.get(a) ?? optionUnknown(a, 'notApplicable')) };
}

/** Car `carId`'s call on the known starting point `start`. */
function callFor(input: ScCallInput, start: StartingPoint, at: number, carId: CarId, car: ScCallCar, rng: Rng): ScCallBlocks {
  const { strategy } = input;
  const field = plannedField(start, plannedCars(strategy, start));
  const lap = startLapOf(field, carId);
  const why = notPlannedWhy(strategy, start, carId);
  if (why !== null) return callUnknown(input, carId, lap, car, why);
  const hazard = strategy.hazard;
  if (!hazard.known) return callUnknown(input, carId, lap, car, hazard.reason);

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
  // our cars' SC/VSC reaction to a later neutralisation (spec §5.2): the car's from its solve, a committed teammate's from its own
  const reactions = reactionsOf(strategy, start, Object.keys(sets).map((k) => Number(k) as CarId), (k) => (k === carId ? sol : null));
  // the call reads no traffic outcome: the strategy config's gap, no traffic laps
  const base = { start: callStart, car: carId, committed, rivalRules, traffic: { gapMs: strategyConfigOf(strategy.config).trafficGapMs, laps: 0 }, reactions };
  const mcHazard = toMcHazard(hazard, callStart);
  const own = strategy.committed[carId] ?? null;
  const ctx: CallContext = {
    sol,
    lap: dp.fromLap,
    car,
    sets: new Set((callStart.sets[carId] ?? []).map((s) => s.compound)),
    committed: own === null ? null : followable(callStart, carId, own).policy,
    cars: callStart.cars,
    at,
    base,
  };
  const forced = (condition: ScCondition): Under => {
    const remaining = Float64Array.from(hazard.value.durationLaps[condition]);
    return {
      under: { condition, remaining },
      hazard: { ...mcHazard, active: { condition, remaining: Float64Array.from(remaining) } },
      lapsLeft: expectedLaps(hazard.value.durationLaps[condition], at),
    };
  };

  const out = input.neutralised;
  if (out === null) {
    const budget = Math.floor(cap / 3);
    const green: Under = { under: undefined, hazard: { ...mcHazard, active: null }, lapsLeft: unknown('notApplicable') };
    const blocks = [blockOn(ctx, 'sc', forced('sc'), budget, rng), blockOn(ctx, 'vsc', forced('vsc'), budget, rng), blockOn(ctx, 'green', green, budget, rng)];
    return { carId, lap: dp.fromLap, out, blocks };
  }
  // a neutralisation out: its block as it is; without race-hazard's `active` yet, forced from now as under green
  const active = hazard.value.active;
  const real: Under =
    mcHazard.active?.condition === out && active !== null ? { under: undefined, hazard: mcHazard, lapsLeft: expectedLaps(active.remainingLaps, at) } : forced(out);
  return { carId, lap: dp.fromLap, out, blocks: [blockOn(ctx, out, real, cap, rng)] };
}

/** Car `carId`'s value: no block where the call does not apply (R29), else its blocks. */
function valueOf(input: ScCallInput, carId: CarId, car: ScCallCar, rng: Rng): ScCallBlocks {
  const s = input.strategy.start;
  const lap = s.known ? startLapOf(s.value, carId) : car.lap;
  if (car.effect === 'notApplicable' || car.boxedUnder) return { carId, lap, out: input.neutralised, blocks: [] };
  if (!s.known) return callUnknown(input, carId, car.lap, car, s.reason);
  return callFor(input, s.value, s.at, carId, car, rng);
}

/** Per our car its blocks (runs in a worker); every car of ours with a `cars` entry present, a rival absent. */
export function run(input: ScCallInput, rng: Rng): ScCallOutput {
  const out: ScCallOutput = {};
  for (const carId of input.strategy.ourCars) {
    const car = input.cars[carId];
    if (car !== undefined) out[carId] = valueOf(input, carId, car, rng);
  }
  return out;
}

/** The job's parts (C51): one per our car with a `cars` entry, in our cars' order, each its own thread (budget ≤ 5 s per
 * car, spec §6.3); the input as it is when there is no car. The shared strategy input stays whole. */
export function splitScCall(input: ScCallInput): ScCallInput[] {
  const cars = input.strategy.ourCars.filter((car) => input.cars[car] !== undefined);
  return cars.length === 0 ? [input] : cars.map((car) => ({ ...input, cars: { [car]: input.cars[car] as ScCallCar } }));
}

/** The parts' outputs joined: each car's value from its part. */
export function mergeScCall(outs: readonly ScCallOutput[]): ScCallOutput {
  return Object.assign({}, ...outs) as ScCallOutput;
}
