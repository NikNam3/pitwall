// `sc-call` as a job (SP4.3b spec §9.3; plan SP4.3b2 Task 9 rows 1–5, 10–12 and 14; C3, C14, C41, C43, C44, C51):
// `prepare` through its guarded view on `strategy`'s small generator race seen from our two cars, then `run` with a
// seeded generator (how the tests read the job: `./support.ts`). Every `solveDp`, `bestWith` and `scoreCalls` call the
// job makes is recorded (the real ones run), so the tests see each call's forced neutralisation, its candidates and
// their outcomes. The job calls the simulators through their units' index (`strategy-dp/index.ts`,
// `race-monte-carlo/index.ts`).
//
// Ported from the 4.2 calculator's tests (C82: the calculator goes, the behaviour that stays is ported): the rejoin
// position, the stop's loss and its source per condition (row 5), our cars only, and `notApplicable` in the pit lane
// (row 4; the 4.2 value was absent there, the job's is present with every `Known` unknown).
import { SC_CALL_GAIN_BINS, unknown, type CarId, type Policy, type RaceHazard, type ScCall, type Trigger } from '@pitwall/domain';
import { createRng, type EngineView } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mcModule from '../../src/race-monte-carlo/index.ts';
import type { CallCandidate, CallInput, CallOutcome, CallResult } from '../../src/race-monte-carlo/index.ts';
import { createRun, playOut, scenarioOf } from '../../src/race-monte-carlo/scenarios.ts';
import { SC_CALL, SC_CALL_JOB } from '../../src/sc-call/index.ts';
import { run, type ScCallInput, type ScCallOutput } from '../../src/sc-call/job.ts';
import { binShares } from '../../src/shared/distribution.ts';
import { policyOf, toMcHazard } from '../../src/shared/strategy-input/index.ts';
import type * as dpModule from '../../src/strategy-dp/index.ts';
import type { DpFirst, DpInput, DpPlan, DpSolution, DpUnder } from '../../src/strategy-dp/index.ts';
import { guardedQuick } from '../situated.ts';
import { JOB_UNITS } from '../units.ts';
import {
  activityOf,
  ALL_NOT_APPLICABLE,
  CALIBRATION_SOURCE,
  callOf,
  CAP,
  DEFAULT_SOURCE,
  firstFrameWith,
  GREEN,
  knownsOf,
  LAP,
  LOSSES,
  OURS,
  PLAYER,
  POSITIONS,
  rejoinOf,
  rejoinOutput,
  rowOf,
  SC_BOX,
  SC_OUT,
  scViewAt,
  scViewAtFrame,
  sessionPhaseOf,
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
    solveDp: (input: DpInput) => {
      const solution = real.solveDp(input);
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
  expect(own, `one solveDp for car ${car}`).toHaveLength(1);
  return own[0]!;
}

/** Car `car`'s `scoreCalls` calls. */
const scoresOf = (car: CarId) => calls.scores.filter((s) => s.input.car === car);

/** Car `car`'s `scoreCalls` call whose hazard forces (or holds) `condition` from now. */
function scoreUnder(car: CarId, condition: 'sc' | 'vsc') {
  const found = scoresOf(car).filter((s) => s.input.hazard.active?.condition === condition);
  expect(found, `one scoreCalls for car ${car} under ${condition}`).toHaveLength(1);
  return found[0]!;
}

/** A call's box candidate (its first stop at `lap`) and stay-out candidate (its first stop after `lap`), with their outcomes. */
function pairOf(score: { input: CallInput; result: CallResult }, lap: number): { box: CallCandidate; stay: CallCandidate; boxOut: CallOutcome; stayOut: CallOutcome } {
  const { candidates } = score.input;
  expect(candidates).toHaveLength(2);
  const boxAt = candidates.findIndex((c) => c.policy.stops[0]?.lap === lap);
  const stayAt = candidates.findIndex((c) => (c.policy.stops[0]?.lap ?? Infinity) > lap);
  expect(boxAt, 'a box candidate').toBeGreaterThanOrEqual(0);
  expect(stayAt, 'a stay-out candidate').toBeGreaterThanOrEqual(0);
  return { box: candidates[boxAt]!, stay: candidates[stayAt]!, boxOut: score.result.outcomes[boxAt]!, stayOut: score.result.outcomes[stayAt]! };
}

/** Per scenario stay − box finish (places gained by boxing), its mean, the share with box ahead, its bins. */
function statsOf(boxOut: CallOutcome, stayOut: CallOutcome) {
  const n = boxOut.finish.length;
  const diff = Float64Array.from({ length: n }, (_, i) => (stayOut.finish[i] ?? 0) - (boxOut.finish[i] ?? 0));
  let sum = 0;
  let ahead = 0;
  for (let i = 0; i < n; i++) {
    sum += diff[i]!;
    if ((boxOut.finish[i] ?? 0) < (stayOut.finish[i] ?? 0)) ahead++;
  }
  return { diff, mean: sum / n, pGain: ahead / n, bins: binShares(diff, SC_CALL_GAIN_BINS) };
}

const valueOf = <T>(k: { known: boolean; value?: T }, what: string): T => {
  expect(k.known, what).toBe(true);
  return (k as { value: T }).value;
};

/** The view at the leader's lap `lap` of the green race. */
const green = (lap = LAP, spec: ScViewSpec = {}) => scViewAt(GREEN(), lap, spec);

/** The stay-out trigger of a forced `condition` at `lap`: it covers only the neutralisation out at `lap`. */
const stayOutTrigger = (condition: 'sc' | 'vsc', lap: number): Trigger => ({ kind: 'neutralised', condition, fromLap: lap, toLap: lap, action: 'stayOut' });

describe('sc-call: the job', () => {
  it('is a C51 job: id sc-call, strategy\'s trigger and input reads plus rejoin, a module exporting run', async () => {
    expect(SC_CALL_JOB.kind).toBe('job');
    expect(SC_CALL_JOB.id).toBe(SC_CALL);
    expect(SC_CALL_JOB.reads).toContainEqual({ calculator: 'rejoin' });
    const mod = (await import(SC_CALL_JOB.module.href)) as { run?: unknown };
    expect(typeof mod.run).toBe('function');
  });

  // row 1
  it('green: both rows; ePosDelta, pGain and gainBins from the paired box and stay-out runs', () => {
    const view = green();
    const hazard = hazardOf(view);
    const out = runOn(view);
    expect(Object.keys(out).sort()).toEqual(OURS.map(String).sort());
    for (const car of OURS) {
      const call: ScCall = callOf(out, car);
      expect(call.carId).toBe(car);
      expect(call.rows.map((r) => r.condition)).toEqual(['sc', 'vsc']);
      const { input: dpInput } = solveOf(car);
      expect(call.lap, 'the DP start lap').toBe(dpInput.fromLap);
      // one scoreCalls per condition, each forcing it from now; 2 candidates × floor(cap / 4) scenarios, to the flag
      expect(scoresOf(car)).toHaveLength(2);
      let policies = 0;
      for (const condition of ['sc', 'vsc'] as const) {
        const score = scoreUnder(car, condition);
        const { input } = score;
        expect(input.scenarios).toBe(Math.floor(CAP / 4));
        policies += input.scenarios * input.candidates.length;
        for (const c of input.candidates) {
          expect(c.untilLap).toBeNull();
          expect(c.rival).toBeNull();
        }
        // the forced neutralisation: race-hazard's duration pmf as its laps left; the tables aligned with the starting point's lap
        expect(input.hazard.active?.remaining).toEqual(Float64Array.from(hazard.durationLaps[condition]));
        const aligned = toMcHazard(view.outputs.get('race-hazard') as RaceHazard, input.start);
        expect(input.hazard.byLap).toEqual(aligned.byLap);
        expect(input.hazard.vscByLap).toEqual(aligned.vscByLap);

        const { boxOut, stayOut } = pairOf(score, call.lap);
        const s = statsOf(boxOut, stayOut);
        const row = rowOf(call, condition);
        expect(valueOf(row.ePosDelta, `${condition} ePosDelta`)).toBeCloseTo(s.mean, 9);
        expect(valueOf(row.pGain, `${condition} pGain`)).toBeCloseTo(s.pGain, 9);
        const bins = valueOf(row.gainBins, `${condition} gainBins`);
        expect(bins).toHaveLength(SC_CALL_GAIN_BINS.count);
        bins.forEach((b, i) => expect(b, `${condition} bin ${i}`).toBeCloseTo(s.bins[i]!, 9));
      }
      expect(policies, 'the scenario-policy cap (a count, C2)').toBeLessThanOrEqual(CAP);
    }
  });

  // row 2
  it("range is the DP's SC (VSC) trigger range for the next stop", () => {
    const out = runOn(green());
    let some = false;
    for (const car of OURS) {
      const call = callOf(out, car);
      const thresholds = calls.dp.dpResult(solveOf(car).solution).thresholds;
      for (const condition of ['sc', 'vsc'] as const) {
        const t = thresholds.find((x): x is Extract<Trigger, { kind: 'neutralised' }> => x.kind === 'neutralised' && x.condition === condition);
        const range = rowOf(call, condition).range;
        if (t === undefined) {
          expect(range.known, `car ${car} ${condition}: no trigger, no range`).toBe(false);
          continue;
        }
        some = true;
        expect(valueOf(range, `car ${car} ${condition} range`)).toEqual({ fromLap: t.fromLap, toLap: t.toLap });
      }
    }
    expect(some, 'the DP gives a neutralised trigger on the test race').toBe(true);
  });

  // row 3
  it('an SC out: the SC row on the real condition with its remaining laps; the VSC row notApplicable', () => {
    const view = scViewAt(SC_OUT(), 6);
    expect(sessionPhaseOf(view)?.kind, 'an SC is out').toBe('neutralised');
    const hazard = hazardOf(view);
    expect(hazard.active?.condition).toBe('sc');
    const out = runOn(view);
    for (const car of OURS) {
      const call = callOf(out, car);
      const { solution } = solveOf(car);
      // one run on the real condition: race-hazard's hazard as it is (its laps left), floor(cap / 2) scenarios
      const scores = scoresOf(car);
      expect(scores).toHaveLength(1);
      const score = scores[0]!;
      expect(score.input.scenarios).toBe(Math.floor(CAP / 2));
      expect(score.input.hazard).toEqual(toMcHazard(view.outputs.get('race-hazard') as RaceHazard, score.input.start));
      expect(score.input.hazard.active?.remaining).toEqual(Float64Array.from(hazard.active!.remainingLaps));
      // the DP is queried on the real condition (its input's `active`), so `under` is not given
      const own = calls.bests.filter((b) => b.solution === solution);
      expect(own.length).toBeGreaterThan(0);
      for (const b of own) expect(b.under, json(b.first)).toBeUndefined();

      const { boxOut, stayOut } = pairOf(score, call.lap);
      const s = statsOf(boxOut, stayOut);
      const sc = rowOf(call, 'sc');
      expect(valueOf(sc.ePosDelta, 'sc ePosDelta')).toBeCloseTo(s.mean, 9);
      expect(valueOf(sc.pGain, 'sc pGain')).toBeCloseTo(s.pGain, 9);
      expect(knownsOf(rowOf(call, 'vsc'))).toEqual(ALL_NOT_APPLICABLE);
    }
  });

  // row 4
  it('our car in the pit lane (boxStop) or already boxed under this neutralisation: both rows notApplicable', () => {
    // in the pit lane: the green race, our car's stop on lap 10
    const inBox = firstFrameWith(GREEN(), PLAYER, 'boxStop');
    const boxView = scViewAtFrame(GREEN(), inBox);
    expect(activityOf(boxView, PLAYER)).toBe('boxStop');
    const boxed = callOf(runOn(boxView), PLAYER);
    for (const row of boxed.rows) expect(knownsOf(row), `boxStop ${row.condition}`).toEqual(ALL_NOT_APPLICABLE);
    expect(scoresOf(PLAYER), 'no run for a car in the pit lane').toEqual([]);

    // boxed under the SC (deployed during lap 9, in during lap 12): back on track, the SC still out
    const race = SC_BOX();
    // 20 frames (10 s) into the out lap
    const out = firstFrameWith(race, PLAYER, 'outLap', firstFrameWith(race, PLAYER, 'boxStop')) + 20;
    const underView = scViewAtFrame(race, out);
    expect(sessionPhaseOf(underView)?.kind, 'the SC still out').toBe('neutralised');
    expect(activityOf(underView, PLAYER)).toBe('outLap');
    const after = callOf(runOn(underView), PLAYER);
    for (const row of after.rows) expect(knownsOf(row), `boxed under the SC ${row.condition}`).toEqual(ALL_NOT_APPLICABLE);
    expect(scoresOf(PLAYER), 'no run after boxing under it').toEqual([]);
  });

  // row 5
  it("rejoin position, loss and its source equal rejoin's and the 4.2 values (ported rows)", () => {
    const INSUFFICIENT = unknown('insufficientData');
    const NOT_RECEIVED = unknown('notReceived');
    const RIVAL = 0 as CarId;
    const rejoin = rejoinOutput({
      [PLAYER]: rejoinOf(PLAYER),
      [TEAMMATE]: rejoinOf(TEAMMATE, { ...POSITIONS, sc: INSUFFICIENT }, { ...LOSSES, vsc: NOT_RECEIVED }),
      // rejoin never holds a rival; if it does, the rival stays absent
      [RIVAL]: rejoinOf(RIVAL),
    });
    const out = runOn(green(LAP, { rejoin }));
    expect(Object.hasOwn(out, RIVAL)).toBe(false);

    // 4.2 row 1: [sc: 9, 9 800, default], [vsc: 10, 13 100, calibration]
    const ours = callOf(out, PLAYER);
    expect(rowOf(ours, 'sc').rejoinPosition).toMatchObject({ known: true, value: 9 });
    expect(rowOf(ours, 'sc').lossMs).toMatchObject({ known: true, value: 9_800 });
    expect(rowOf(ours, 'sc').lossSource).toEqual(DEFAULT_SOURCE);
    expect(rowOf(ours, 'vsc').rejoinPosition).toMatchObject({ known: true, value: 10 });
    expect(rowOf(ours, 'vsc').lossMs).toMatchObject({ known: true, value: 13_100 });
    expect(rowOf(ours, 'vsc').lossSource).toEqual(CALIBRATION_SOURCE);

    // 4.2: an unknown rejoin position and an unknown loss pass through with their reasons
    const mate = callOf(out, TEAMMATE);
    expect(rowOf(mate, 'sc').rejoinPosition).toEqual(INSUFFICIENT);
    expect(rowOf(mate, 'sc').lossMs).toMatchObject({ known: true, value: 9_800 });
    expect(rowOf(mate, 'vsc').rejoinPosition).toMatchObject({ known: true, value: 10 });
    expect(rowOf(mate, 'vsc').lossMs).toEqual(NOT_RECEIVED);
    expect(rowOf(mate, 'vsc').lossSource).toEqual(CALIBRATION_SOURCE);

    // under an SC out, the SC row's too
    const sc = callOf(runOn(scViewAt(SC_OUT(), 6, { rejoin })), PLAYER);
    expect(rowOf(sc, 'sc').rejoinPosition).toMatchObject({ known: true, value: 9 });
    expect(rowOf(sc, 'sc').lossMs).toMatchObject({ known: true, value: 9_800 });
    expect(rowOf(sc, 'sc').lossSource).toEqual(DEFAULT_SOURCE);
  });

  // row 10
  it('stay out: in every scenario our car does not box while the forced neutralisation lasts; its next stop comes after it ends', () => {
    const out = runOn(green(7));
    let checked = 0;
    for (const car of OURS) {
      const call = callOf(out, car);
      for (const condition of ['sc', 'vsc'] as const) {
        const score = scoreUnder(car, condition);
        const { stay } = pairOf(score, call.lap);
        const { input } = score;
        const fixed: Record<number, Policy | null> = {};
        for (const key of Object.keys(input.start.sets)) fixed[Number(key)] = input.committed[Number(key) as CarId] ?? null;
        // the scenarios as scoreCalls draws them (any seed: the property holds in every scenario)
        const mcRun = createRun(input.start, input.hazard, input.rivalRules, fixed, createRng(SEED));
        for (let id = 1; id <= input.scenarios; id++) {
          const entry = scenarioOf(mcRun, id);
          const forced = entry.scenario.neutralisations[0];
          expect(forced?.kind, `scenario ${id}: the forced ${condition}`).toBe(condition);
          expect(forced?.fromLap).toBe(input.start.lap);
          const played = playOut(stay.policy, { neutralisations: entry.scenario.neutralisations, lapsTotal: input.start.lapsTotal, weather: entry.weather, wearRateOffPct: entry.wearRateOffPct[car] ?? 0 }, new Uint8Array(stay.policy.triggers.length));
          const inside = played.stops.filter((s) => s.lap >= forced!.fromLap && s.lap <= forced!.toLap);
          expect(inside, `car ${car}, ${condition}, scenario ${id}: no stop under the forced ${condition} (laps ${forced!.fromLap}–${forced!.toLap})`).toEqual([]);
          const next = played.stops.find((s) => s.lap >= call.lap);
          if (next !== undefined) expect(next.lap, `car ${car}, ${condition}, scenario ${id}: the next stop after it ends`).toBeGreaterThan(forced!.toLap);
          checked++;
        }
      }
    }
    expect(checked).toBe(OURS.length * 2 * Math.floor(CAP / 4));
  });

  // row 11
  it("the box candidate's DP query uses the forced neutralisation (its stop costs that condition's loss)", () => {
    const view = green();
    const hazard = hazardOf(view);
    const out = runOn(view);
    for (const car of OURS) {
      const call = callOf(out, car);
      const { solution } = solveOf(car);
      const thresholds = calls.dp.dpResult(solution).thresholds;
      for (const condition of ['sc', 'vsc'] as const) {
        const remaining = Float64Array.from(hazard.durationLaps[condition]);
        // the query: box at the start lap, the DP picks the compound, from the state "that neutralisation out now"
        const query = calls.bests.filter(
          (b) => b.solution === solution && 'stopLap' in b.first && b.first.stopLap === call.lap && b.first.compound === 'best' && b.under?.condition === condition,
        );
        expect(query, `car ${car}: the box query under ${condition}`).toHaveLength(1);
        expect(query[0]!.under?.remaining).toEqual(remaining);
        // the candidate is that plan with the DP's thresholds
        const plan = calls.dp.bestWith(solution, { stopLap: call.lap, compound: 'best' }, { condition, remaining });
        expect(plan, `car ${car}: a box plan under ${condition}`).not.toBeNull();
        const { box } = pairOf(scoreUnder(car, condition), call.lap);
        expect(box.policy).toEqual(policyOf(plan!, thresholds));
        expect(box.policy.stops[0]?.lap).toBe(call.lap);
      }
    }
  });

  // row 12
  it('gainBins: 9 shares over SC_CALL_GAIN_BINS, a difference beyond ±4 in the end bins', () => {
    const out = runOn(green());
    for (const car of OURS) {
      const call = callOf(out, car);
      for (const condition of ['sc', 'vsc'] as const) {
        const { boxOut, stayOut } = pairOf(scoreUnder(car, condition), call.lap);
        const { diff } = statsOf(boxOut, stayOut);
        const bins = valueOf(rowOf(call, condition).gainBins, `${condition} gainBins`);
        expect(bins).toHaveLength(9);
        expect(bins.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        // places −4 … +4, one per whole place; the ends hold the tails
        const n = diff.length;
        const share = (f: (d: number) => boolean) => diff.filter(f).length / n;
        expect(bins[0]).toBeCloseTo(share((d) => d <= -4), 9);
        expect(bins[8]).toBeCloseTo(share((d) => d >= 4), 9);
        for (let place = -3; place <= 3; place++) expect(bins[place + 4], `${condition} ${place}`).toBeCloseTo(share((d) => d === place), 9);
      }
    }
    // the binning of the tails itself: −6 and +5 land in the end bins
    expect(binShares(Float64Array.of(-6, 0, 5, 5), SC_CALL_GAIN_BINS)).toEqual([0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.5]);
  });

  // row 14
  it("a second neutralisation later in a scenario: the stay-out candidate follows the DP's threshold for it", () => {
    const out = runOn(green());
    let some = false;
    for (const car of OURS) {
      const call = callOf(out, car);
      const thresholds = calls.dp.dpResult(solveOf(car).solution).thresholds;
      for (const condition of ['sc', 'vsc'] as const) {
        const score = scoreUnder(car, condition);
        const { stay } = pairOf(score, call.lap);
        // the DP's thresholds kept, plus the one stay-out trigger covering only the forced neutralisation
        expect(stay.policy.triggers).toHaveLength(thresholds.length + 1);
        for (const t of thresholds) expect(stay.policy.triggers).toContainEqual(t);
        expect(stay.policy.triggers).toContainEqual(stayOutTrigger(condition, call.lap));

        // a later neutralisation inside a DP box threshold that starts after the forced one: the car boxes as the DP says
        const later = thresholds.find(
          (t): t is Extract<Trigger, { kind: 'neutralised' }> & { action: { box: Policy['stops'][number]['compound'] } } =>
            t.kind === 'neutralised' && typeof t.action === 'object' && t.fromLap > call.lap + 1 && Math.max(t.fromLap, call.lap + 2) <= t.toLap,
        );
        if (later === undefined) continue;
        some = true;
        const at = Math.max(later.fromLap, call.lap + 2);
        const neutralisations = [
          { kind: condition, fromLap: call.lap, toLap: call.lap },
          { kind: later.condition, fromLap: at, toLap: at },
        ];
        const played = playOut(stay.policy, { neutralisations, lapsTotal: score.input.start.lapsTotal, weather: null, wearRateOffPct: 0 }, new Uint8Array(stay.policy.triggers.length));
        expect(played.stops, `car ${car}, forced ${condition}: boxes under the later ${later.condition} on lap ${at}`).toContainEqual({ lap: at, compound: later.action.box });
      }
    }
    expect(some, 'the DP gives a box threshold after the forced neutralisation on the test race').toBe(true);
  });
});

const json = (x: unknown): string => JSON.stringify(x);
