// `sc-call` as a job (SP4.3d spec §6.3; plan SP4.3d1 Task 6 rows 1–5; C3, C14, C41, C43, C44, C51): `prepare` through
// its guarded view on `strategy`'s small generator race seen from our two cars, then `run` with a seeded generator
// (how the tests read the job: `./support.ts`). Every `solveWorld`, `bestWith` and `scoreCalls` call the job makes is
// recorded (the real ones run), so the tests see each call's condition, its candidates and their outcomes. The job
// calls the simulators through their units' index (`strategy-dp/index.ts`, `race-monte-carlo/index.ts`).
//
// SP4.3d1 Task 6 (C82): the value is `ScCallBlocks`, per condition SC, VSC and GREEN six options (stay, box S, M, H,
// I, W). Deleted with the old `ScCall` rows: the DP's trigger `range` (Task 3), the places-gained bins
// (`gainBins`, replaced by each option's `positionPmf`) and the box run's simulated rejoin median (B8, replaced by
// `rejoin`'s position, row 5). Ported: the job's shape, the SC out on its real condition, `notApplicable` in the pit
// lane and after boxing under the neutralisation, the stop's loss and source from `rejoin`, the stay-out candidate and
// the box candidate's DP query (now per compound).
//
// The test agent's readings (Task 6 test phase):
// - The blocks come in the order SC, VSC, GREEN; the options in the order stay, S, M, H, I, W.
// - Each condition is scored in its own `scoreCalls` calls: SC and VSC with that condition forced from now
//   (`hazard.active`), GREEN with no neutralisation out now (`hazard.active` null).
// - "box X" under a condition is `bestWith(solution, { stopLap: lap, compound: X }, under)`, `under` the forced
//   condition with `race-hazard`'s duration pmf, none for GREEN (as `pit-sweep` queries it) and none under the real
//   neutralisation out (the DP input's `active`).
// - `ePosDelta` is stay's E[pos] minus the option's (positive = good), from the same common scenarios; the
//   `positionPmf` is indexed by place − 1 (`shared/distribution.ts` `placePmf`, as `pit-sweep`'s rows).
// - Stay's rejoin position is `rejoin`'s position now (`Rejoin.position`, the mockup's "P8"); a box option's is
//   `rejoin`'s `rejoinPosition` of its condition.
// - Row 4's "within their two SEs": |ΔE[pos]| ≤ 2 √(SE₁² + SE₂²).
import { unknown, type CarId, type Policy, type RaceHazard, type ScCallBlocks, type TyreSet } from '@pitwall/domain';
import { createRng, type EngineView } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mcModule from '../../src/race-monte-carlo/index.ts';
import type { CallCandidate, CallInput, CallResult } from '../../src/race-monte-carlo/index.ts';
import { PIT_SWEEP_JOB } from '../../src/pit-sweep/index.ts';
import { run as runPitSweep } from '../../src/pit-sweep/job.ts';
import { SC_CALL, SC_CALL_BEHAVIOUR, SC_CALL_JOB } from '../../src/sc-call/index.ts';
import { run, type ScCallInput, type ScCallOutput } from '../../src/sc-call/job.ts';
import { policyOf, toMcHazard } from '../../src/shared/strategy-input/index.ts';
import type * as dpModule from '../../src/strategy-dp/index.ts';
import type { DpFirst, DpInput, DpPlan, DpSolution, DpUnder } from '../../src/strategy-dp/index.ts';
import { mean, seOf, sweepViewAt } from '../pit-sweep/support.ts';
import { guardedQuick } from '../situated.ts';
import { stopIn } from '../strategy/support.ts';
import { JOB_UNITS } from '../units.ts';
import {
  activityOf,
  ALL_NO_SET,
  ALL_NOT_APPLICABLE,
  ANSWERS,
  blockOf,
  CALIBRATION_SOURCE,
  callOf,
  CAP,
  COMPOUND_OF,
  DEFAULT_SOURCE,
  firstFrameWith,
  GREEN,
  knownsOf,
  LAP,
  LOSSES,
  NO_SET,
  optionOf,
  optionsOf,
  OURS,
  PLAYER,
  POSITION_NOW,
  POSITIONS,
  rejoinOf,
  rejoinOutput,
  SC_BOX,
  SC_OUT,
  scViewAt,
  scViewAtFrame,
  sessionPhaseOf,
  SESSION_SOURCE,
  TEAMMATE,
  type ScViewSpec,
} from './support.ts';

type BestCall = { solution: DpSolution; first: DpFirst; under: DpUnder | undefined; plan: DpPlan | null };

const calls = vi.hoisted(() => ({
  solves: [] as { input: DpInput; solution: DpSolution }[],
  bests: [] as BestCall[],
  scores: [] as { input: CallInput; result: CallResult }[],
  dp: undefined as unknown as typeof dpModule,
}));

vi.mock('../../src/strategy-dp/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof dpModule>();
  calls.dp = real;
  return {
    ...real,
    // SP4.3c Task 19: the call solves the first weather world (`solveWorld(input, 0)`) and queries it
    solveWorld: (input: DpInput, world: number) => {
      const solution = real.solveWorld(input, world);
      calls.solves.push({ input, solution });
      return solution;
    },
    bestWith: (...args: [DpSolution, DpFirst, DpUnder?]) => {
      const plan = real.bestWith(...args);
      calls.bests.push({ solution: args[0], first: args[1], under: args[2], plan });
      return plan;
    },
  };
});

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mcModule>();
  return {
    ...real,
    scoreCalls: (...args: Parameters<typeof real.scoreCalls>) => {
      const result = real.scoreCalls(...args);
      calls.scores.push({ input: args[0], result });
      return result;
    },
  };
});

beforeEach(() => {
  calls.solves = [];
  calls.bests = [];
  calls.scores = [];
});

const SEED = 1_808_224_301;

type Condition = 'sc' | 'vsc' | 'green';
const CONDITIONS: readonly Condition[] = ['sc', 'vsc', 'green'];

/** The job's `prepare` as the bridge's trigger calculator runs it, through its guarded view (C41). */
const prepare = (() => {
  const unit = JOB_UNITS.find((u) => u.id === SC_CALL);
  if (unit === undefined) throw new Error('sc-call is no job unit');
  const guarded = guardedQuick(unit);
  return (view: EngineView): ScCallInput => guarded.compute(view) as ScCallInput;
})();

/** The job's output on `view`, as the worker computes it (a structured clone of the input, C51). */
function runOn(view: EngineView): ScCallOutput {
  const input = structuredClone(prepare(view));
  return run(input, createRng(SEED));
}

/** The view's `race-hazard` output; fails the test when it is unknown. */
function hazardOf(view: EngineView): Extract<RaceHazard, { known: true }>['value'] {
  const h = view.outputs.get('race-hazard') as RaceHazard | undefined;
  expect(h?.known, 'race-hazard known on the view').toBe(true);
  return (h as Extract<RaceHazard, { known: true }>).value;
}

/** Car `car`'s one DP solve. */
function solveOf(car: CarId): { input: DpInput; solution: DpSolution } {
  const own = calls.solves.filter((s) => s.input.car === car);
  expect(own, `one solveWorld for car ${car}`).toHaveLength(1);
  return own[0]!;
}

/** Car `car`'s `scoreCalls` calls. */
const scoresOf = (car: CarId) => calls.scores.filter((s) => s.input.car === car);

/** Car `car`'s `scoreCalls` calls of `condition`: SC or VSC forced (or out) from now, or GREEN with none out. */
function scoresUnder(car: CarId, condition: Condition) {
  const found = scoresOf(car).filter((s) => (condition === 'green' ? s.input.hazard.active == null : s.input.hazard.active?.condition === condition));
  expect(found.length, `a scoreCalls for car ${car} under ${condition}`).toBeGreaterThan(0);
  return found;
}

/** The candidate of car `car`'s calls under `condition` that plays `policy`, with its outcome; fails without one. */
function scoredAs(car: CarId, condition: Condition, policy: Policy, what: string): { candidate: CallCandidate; finish: Int8Array } {
  for (const s of scoresUnder(car, condition)) {
    const i = s.input.candidates.findIndex((c) => JSON.stringify(c.policy) === JSON.stringify(policy));
    if (i >= 0) return { candidate: s.input.candidates[i]!, finish: s.result.outcomes[i]!.finish };
  }
  throw new Error(`${what}: no candidate of car ${car} under ${condition} plays ${json(policy)}`);
}

/** Car `car`'s recorded `bestWith` query for "box at `lap` onto `compound`" under `condition` (`under` absent for GREEN). */
function boxQueryOf(car: CarId, lap: number, compound: string, condition: Condition | 'real'): BestCall {
  const { solution } = solveOf(car);
  const found = calls.bests.filter(
    (b) =>
      b.solution === solution &&
      'stopLap' in b.first &&
      b.first.stopLap === lap &&
      b.first.compound === compound &&
      (condition === 'green' || condition === 'real' ? b.under === undefined : b.under?.condition === condition),
  );
  expect(found.length, `car ${car}: the box-${compound} query under ${condition}`).toBeGreaterThan(0);
  return found[0]!;
}

const valueOf = <T>(k: { known: boolean; value?: T }, what: string): T => {
  expect(k.known, what).toBe(true);
  return (k as { value: T }).value;
};

/** The view at the leader's lap `lap` of the green race. */
const green = (lap = LAP, spec: ScViewSpec = {}) => scViewAt(GREEN(), lap, spec);

/** A tyre set as `strategy`'s support builds them (`../strategy/support.ts`), any compound. */
const tyreSet = (visualCompound: 'soft' | 'medium' | 'hard' | 'inter', wearPct: number, fitted: boolean): TyreSet => ({
  actualCompound: visualCompound === 'soft' ? 'C3' : visualCompound === 'medium' ? 'C2' : visualCompound === 'hard' ? 'C1' : 'inter',
  visualCompound,
  wearPct,
  available: true,
  fitted,
  recommendedSession: 0,
  lifeSpanLaps: 20,
  usableLifeLaps: 18,
  lapDeltaMs: 0,
});

describe('sc-call: the job', () => {
  it('is a C51 job: id sc-call, strategy\'s trigger and input reads plus rejoin, a module exporting run', async () => {
    expect(SC_CALL_JOB.kind).toBe('job');
    expect(SC_CALL_JOB.id).toBe(SC_CALL);
    expect(SC_CALL_JOB.reads).toContainEqual({ calculator: 'rejoin' });
    const mod = (await import(SC_CALL_JOB.module.href)) as { run?: unknown };
    expect(typeof mod.run).toBe('function');
  });

  // the plan's behaviour table over `session-phase-race` (C44): racing → three blocks, neutralised → its block, the rest notApplicable
  it('behaviour: session-phase-race grid, formation, startLights, suspended, finished, postSession are notApplicable; racing and neutralised are not', () => {
    const rows = SC_CALL_BEHAVIOUR['session-phase-race'] as Record<string, string>;
    for (const kind of ['grid', 'formation', 'startLights', 'suspended', 'finished', 'postSession']) expect(rows[kind], kind).toBe('notApplicable');
    for (const kind of ['racing', 'neutralised']) expect(rows[kind], kind).not.toBe('notApplicable');
    expect(rows.racing).not.toBe(rows.neutralised);
  });

  // row 1
  it('green running: three blocks, six options each, in the order stay, S, M, H, I, W', () => {
    const view = green();
    const hazard = hazardOf(view);
    const out = runOn(view);
    expect(Object.keys(out).sort()).toEqual(OURS.map(String).sort());
    for (const car of OURS) {
      const call: ScCallBlocks = callOf(out, car);
      expect(call.carId).toBe(car);
      expect(call.out).toBeNull();
      expect(call.lap, 'the DP start lap').toBe(solveOf(car).input.fromLap);
      expect(call.blocks.map((b) => b.condition)).toEqual(['sc', 'vsc', 'green']);
      for (const block of call.blocks) {
        expect(block.options.map((o) => o.answer), `car ${car} ${block.condition}`).toEqual(ANSWERS);
        const stay = valueOf(optionOf(block, 'stay').ePos, `car ${car} ${block.condition} stay ePos`);
        for (const option of block.options) {
          if (!option.ePos.known) continue;
          const label = `car ${car} ${block.condition} ${option.answer}`;
          const ePos = option.ePos.value;
          // ΔPOS against staying out, positive = good, on common scenarios
          if (option.answer !== 'stay') expect(valueOf(option.ePosDelta, `${label} ePosDelta`)).toBeCloseTo(stay - ePos, 9);
          const pGain = option.answer === 'stay' ? undefined : valueOf(option.pGain, `${label} pGain`);
          if (pGain !== undefined) expect(pGain >= 0 && pGain <= 1, `${label} pGain ${pGain}`).toBe(true);
          expect(valueOf(option.se, `${label} se`)).toBeGreaterThanOrEqual(0);
          // the finishing distribution: index = place − 1, its mean the option's E[pos]
          const pmf = valueOf(option.positionPmf, `${label} positionPmf`);
          expect(pmf.reduce((a, b) => a + b, 0), label).toBeCloseTo(1, 9);
          expect(pmf.reduce((a, p, i) => a + p * (i + 1), 0), label).toBeCloseTo(ePos, 9);
        }
      }
      // the forced neutralisations: race-hazard's duration pmf as their laps left; GREEN with none out
      for (const condition of ['sc', 'vsc'] as const) {
        for (const s of scoresUnder(car, condition)) expect(s.input.hazard.active?.remaining).toEqual(Float64Array.from(hazard.durationLaps[condition]));
      }
      scoresUnder(car, 'green');
      // the scenario-policy cap (a count, C2), to the flag
      let policies = 0;
      for (const s of scoresOf(car)) {
        policies += s.input.scenarios * s.input.candidates.length;
        for (const c of s.input.candidates) {
          expect(c.untilLap).toBeNull();
          expect(c.rival).toBeNull();
        }
      }
      expect(policies, 'the scenario-policy cap (a count, C2)').toBeLessThanOrEqual(CAP);
    }
  });

  // row 1, the box options (ported from 4.3b2 row 11, per compound now; C43)
  it("box X: the DP's bestWith(solution, { stopLap: lap, compound: X }, under) per condition, the candidate that option plays", () => {
    const view = green();
    const hazard = hazardOf(view);
    const out = runOn(view);
    for (const car of OURS) {
      const call = callOf(out, car);
      for (const condition of CONDITIONS) {
        // the default sets: a fitted medium, a new soft, medium and hard
        for (const answer of ['S', 'M', 'H'] as const) {
          const compound = COMPOUND_OF[answer];
          const query = boxQueryOf(car, call.lap, compound, condition);
          if (condition !== 'green') expect(query.under?.remaining, `${condition} ${answer}`).toEqual(Float64Array.from(hazard.durationLaps[condition]));
          expect(query.plan, `car ${car}: a box-${answer} plan under ${condition}`).not.toBeNull();
          const policy = policyOf(query.plan!);
          expect(policy.stops[0], `${condition} ${answer}`).toEqual({ lap: call.lap, compound });
          scoredAs(car, condition, policy, `${condition} box ${answer}`);
          expect(optionOf(blockOf(call, condition), answer).ePos.known, `car ${car} ${condition} ${answer}`).toBe(true);
        }
      }
    }
  });

  // ported from 4.3b2 row 10: stay = the active plan, else a plan with no stop on the call lap
  it('stay: the committed plan is the stay candidate under every condition; without one, no stop on the call lap', () => {
    const base = green(7);
    const policy = stopIn(base, PLAYER, 4, 'hard');
    const out = runOn(green(7, { decisions: [{ kind: 'planCommitted', carId: PLAYER, policy }] }));
    const lap = callOf(out, PLAYER).lap;
    expect(policy.stops[0]!.lap).toBeGreaterThan(lap);
    for (const condition of CONDITIONS) scoredAs(PLAYER, condition, policy, `${condition} stay`);
    // the teammate has no plan: its stay candidate (every candidate whose first stop is not on the call lap) exists
    const mateLap = callOf(out, TEAMMATE).lap;
    for (const condition of CONDITIONS) {
      const stays = scoresUnder(TEAMMATE, condition).flatMap((s) => s.input.candidates.filter((c) => (c.policy.stops[0]?.lap ?? Infinity) > mateLap));
      expect(stays.length, `teammate ${condition}: a stay candidate`).toBeGreaterThan(0);
    }
  });

  // row 2 (ported from 4.3b2 row 3)
  it("SC out: one block sc, lapsLeft known, out: 'sc'", () => {
    const view = scViewAt(SC_OUT(), 6);
    expect(sessionPhaseOf(view)?.kind, 'an SC is out').toBe('neutralised');
    const hazard = hazardOf(view);
    expect(hazard.active?.condition).toBe('sc');
    const out = runOn(view);
    for (const car of OURS) {
      const call = callOf(out, car);
      expect(call.out).toBe('sc');
      expect(call.blocks.map((b) => b.condition)).toEqual(['sc']);
      const block = blockOf(call, 'sc');
      expect(block.options.map((o) => o.answer)).toEqual(ANSWERS);
      expect(valueOf(block.lapsLeft, 'lapsLeft')).toBeGreaterThan(0);
      // the real condition: race-hazard's hazard as it is (its laps left), never a forced one, and no GREEN run
      const scores = scoresOf(car);
      expect(scores.length).toBeGreaterThan(0);
      for (const s of scores) {
        expect(s.input.hazard).toEqual(toMcHazard(view.outputs.get('race-hazard') as RaceHazard, s.input.start));
        expect(s.input.hazard.active?.remaining).toEqual(Float64Array.from(hazard.active!.remainingLaps));
      }
      // the DP is queried on the real condition (its input's `active`), so `under` is not given
      const { solution } = solveOf(car);
      const own = calls.bests.filter((b) => b.solution === solution);
      expect(own.length).toBeGreaterThan(0);
      for (const b of own) expect(b.under, json(b.first)).toBeUndefined();
      boxQueryOf(car, call.lap, 'hard', 'real');
      expect(optionOf(block, 'H').ePos.known).toBe(true);
    }
  });

  // row 3 (Review Focus 3)
  it("no set: sets S H H I → M and W unknown('noSet'); nothing boxes onto a compound without a set", () => {
    const sets = [tyreSet('hard', 10, true), tyreSet('soft', 0, false), tyreSet('hard', 0, false), tyreSet('inter', 0, false)];
    const out = runOn(green(LAP, { sets: { [PLAYER]: sets, [TEAMMATE]: sets } }));
    for (const car of OURS) {
      const call = callOf(out, car);
      expect(call.blocks.map((b) => b.condition)).toEqual(['sc', 'vsc', 'green']);
      for (const block of call.blocks) {
        for (const answer of ['M', 'W'] as const) expect(knownsOf(optionOf(block, answer)), `car ${car} ${block.condition} ${answer}`).toEqual(ALL_NO_SET);
        for (const answer of ['stay', 'S', 'H', 'I'] as const) {
          for (const [field, value] of Object.entries(knownsOf(optionOf(block, answer)))) expect(value, `car ${car} ${block.condition} ${answer} ${field}`).not.toEqual(NO_SET);
        }
        for (const answer of ['stay', 'S', 'H'] as const) expect(optionOf(block, answer).ePos.known, `car ${car} ${block.condition} ${answer}`).toBe(true);
      }
      // nothing boxes onto a compound it has no set of: no query, no candidate's stop onto medium or wet
      const { solution } = solveOf(car);
      for (const b of calls.bests.filter((x) => x.solution === solution)) {
        if ('stopLap' in b.first) expect(['medium', 'wet'], json(b.first)).not.toContain(b.first.compound);
      }
      for (const s of scoresOf(car)) {
        for (const c of s.input.candidates) for (const stop of c.policy.stops) expect(['medium', 'wet'], json(c.policy)).not.toContain(stop.compound);
      }
    }
  });

  // row 4 (C43)
  it("agreement with the pit sweep: GREEN's box H plays pit-sweep's policy at this lap for H, their E[pos] within their two SEs", () => {
    const options = 18;
    const out = runOn(green(LAP, { scConfig: { maxScenarioPolicies: options * 40 } }));
    const call = callOf(out, PLAYER);
    const lap = call.lap;
    const query = boxQueryOf(PLAYER, lap, 'hard', 'green');
    expect(query.plan).not.toBeNull();
    const policy = policyOf(query.plan!);
    const ours = scoredAs(PLAYER, 'green', policy, 'sc-call green box H');
    const option = optionOf(blockOf(call, 'green'), 'H');
    const ePos = valueOf(option.ePos, 'green H ePos');
    const se = valueOf(option.se, 'green H se');
    expect(ePos).toBeCloseTo(mean(ours.finish), 9);
    expect(se).toBeCloseTo(seOf(ours.finish), 9);

    // the pit sweep on the same view, its rows from now on
    calls.solves = [];
    calls.bests = [];
    calls.scores = [];
    const sweep = runPitSweep(structuredClone(PIT_SWEEP_JOB.prepare(sweepViewAt(GREEN(), LAP, { sweepConfig: { maxScenarioPolicies: 600 } }))), createRng(SEED));
    const table = sweep[PLAYER]?.byCompound.hard;
    expect(table?.known, "pit-sweep's hard table").toBe(true);
    const row = table!.known ? table!.value.rows.find((r) => r.stopLap === lap) : undefined;
    expect(row, `pit-sweep's hard row at lap ${lap}`).toBeDefined();
    // the same DP answer: bestWith(solution, { stopLap: lap, compound: 'hard' }) without `under`, the same policy
    const sweepQuery = calls.bests.find((b) => 'stopLap' in b.first && b.first.stopLap === lap && b.first.compound === 'hard' && b.under === undefined);
    expect(sweepQuery?.plan, "pit-sweep's box-H query at this lap").toBeTruthy();
    expect(policyOf(sweepQuery!.plan!)).toEqual(policy);
    const theirs = calls.scores.flatMap((s) => s.input.candidates.map((c, i) => ({ c, finish: s.result.outcomes[i]!.finish }))).find((x) => json(x.c.policy) === json(policy));
    expect(theirs, "pit-sweep's candidate plays the same policy").toBeDefined();
    expect(row!.ePos).toBeCloseTo(mean(theirs!.finish), 9);
    const bound = 2 * Math.sqrt(se ** 2 + seOf(theirs!.finish) ** 2);
    expect(Math.abs(ePos - row!.ePos), `sc-call ${ePos} ± ${se}, pit-sweep ${row!.ePos} ± ${seOf(theirs!.finish)}`).toBeLessThanOrEqual(bound);
  });

  // row 5 (replaces 4.3b2 row 5, B8: the box run's median; the loss and its source ported)
  it("rejoin: each option's rejoin position equals rejoin's for that condition; the loss and its source rejoin's", () => {
    const NOT_RECEIVED = unknown('notReceived');
    const RIVAL = 0 as CarId;
    const rejoin = rejoinOutput({
      [PLAYER]: rejoinOf(PLAYER),
      [TEAMMATE]: rejoinOf(TEAMMATE, POSITIONS, { ...LOSSES, vsc: NOT_RECEIVED }),
      // rejoin never holds a rival; if it does, the rival stays absent
      [RIVAL]: rejoinOf(RIVAL),
    });
    const out = runOn(green(LAP, { rejoin }));
    expect(Object.hasOwn(out, RIVAL)).toBe(false);
    for (const car of OURS) {
      const call = callOf(out, car);
      for (const condition of CONDITIONS) {
        const block = blockOf(call, condition);
        expect(optionOf(block, 'stay').rejoinPosition, `car ${car} ${condition} stay`).toMatchObject({ known: true, value: POSITION_NOW });
        // the default sets: a new soft, medium and hard
        for (const answer of ['S', 'M', 'H'] as const) {
          expect(optionOf(block, answer).rejoinPosition, `car ${car} ${condition} ${answer}`).toMatchObject({ known: true, value: valueOf(POSITIONS[condition], 'position') });
        }
      }
    }

    // the stop's loss and its source per condition: [sc: 9 800, default], [vsc: 13 100, calibration], [green: 20 300, session]
    const ours = callOf(out, PLAYER);
    expect(blockOf(ours, 'sc').lossMs).toMatchObject({ known: true, value: 9_800 });
    expect(blockOf(ours, 'sc').lossSource).toEqual(DEFAULT_SOURCE);
    expect(blockOf(ours, 'vsc').lossMs).toMatchObject({ known: true, value: 13_100 });
    expect(blockOf(ours, 'vsc').lossSource).toEqual(CALIBRATION_SOURCE);
    expect(blockOf(ours, 'green').lossMs).toMatchObject({ known: true, value: 20_300 });
    expect(blockOf(ours, 'green').lossSource).toEqual(SESSION_SOURCE);
    // an unknown loss passes through with its reason
    const mate = callOf(out, TEAMMATE);
    expect(blockOf(mate, 'vsc').lossMs).toEqual(NOT_RECEIVED);
    expect(blockOf(mate, 'vsc').lossSource).toEqual(CALIBRATION_SOURCE);

    // under an SC out, the SC block's
    const sc = blockOf(callOf(runOn(scViewAt(SC_OUT(), 6, { rejoin })), PLAYER), 'sc');
    expect(optionOf(sc, 'H').rejoinPosition).toMatchObject({ known: true, value: valueOf(POSITIONS.sc, 'position') });
    expect(sc.lossMs).toMatchObject({ known: true, value: 9_800 });
    expect(sc.lossSource).toEqual(DEFAULT_SOURCE);
  });

  // ported from 4.3b2 row 4
  it('our car in the pit lane (boxStop) or already boxed under this neutralisation: every option notApplicable, no run', () => {
    // in the pit lane: the green race, our car's stop on lap 10
    const inBox = firstFrameWith(GREEN(), PLAYER, 'boxStop');
    const boxView = scViewAtFrame(GREEN(), inBox);
    expect(activityOf(boxView, PLAYER)).toBe('boxStop');
    const boxed = callOf(runOn(boxView), PLAYER);
    for (const { label, option } of optionsOf(boxed)) expect(knownsOf(option), `boxStop ${label}`).toEqual(ALL_NOT_APPLICABLE);
    expect(scoresOf(PLAYER), 'no run for a car in the pit lane').toEqual([]);

    // boxed under the SC (deployed during lap 9, in during lap 12): back on track, the SC still out
    const race = SC_BOX();
    // 20 frames (10 s) into the out lap
    const out = firstFrameWith(race, PLAYER, 'outLap', firstFrameWith(race, PLAYER, 'boxStop')) + 20;
    const underView = scViewAtFrame(race, out);
    expect(sessionPhaseOf(underView)?.kind, 'the SC still out').toBe('neutralised');
    expect(activityOf(underView, PLAYER)).toBe('outLap');
    const after = callOf(runOn(underView), PLAYER);
    for (const { label, option } of optionsOf(after)) expect(knownsOf(option), `boxed under the SC ${label}`).toEqual(ALL_NOT_APPLICABLE);
    expect(scoresOf(PLAYER), 'no run after boxing under it').toEqual([]);
  });
});

const json = (x: unknown): string => JSON.stringify(x);
