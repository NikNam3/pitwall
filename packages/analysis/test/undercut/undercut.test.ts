// `undercut`'s job (SP4.3b spec §9.1, §9.4; plan 4.3b2 Task 7 rows 1–7 and 12; C2, C3, C43, C51): `prepare` on
// `strategy`'s generator race seen from our two cars, then `run` with a seeded generator. Every `scoreCalls` call the
// job makes is recorded (the real scoring runs unless a test replaces its outcomes), so the tests see each case's
// policies, horizon and per-scenario outcomes (how the job is read: `./support.ts`).
import { UNDERCUT_GAIN_BINS, type CarId, type Known, type Undercut, type UndercutRival } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import { rivalNextCompound, type CallCandidate, type CallInput, type CallResult } from '../../src/race-monte-carlo/index.ts';
import { startLapOf } from '../../src/race-forecast/index.ts';
import { binShares } from '../../src/shared/distribution.ts';
import { mcSettingsFrom, policyOf, toDpInput, toMcHazard } from '../../src/shared/strategy-input/index.ts';
import { candidatesForRun } from '../../src/strategy/index.ts';
import { bestWith, dpResult, solveDp } from '../../src/strategy-dp/index.ts';
import { UNDERCUT_CONFIG, UNDERCUT_JOB, type UndercutInput, type UndercutOutput } from '../../src/undercut/index.ts';
import { run } from '../../src/undercut/job.ts';
import {
  expectedRivals,
  GREEN_REJOIN,
  json,
  LAP,
  meanSe,
  medianRange,
  NO_SETS_LEFT,
  OURS,
  PLAYER,
  signedGap,
  TEAMMATE,
  undercutView,
  type UndercutViewSpec,
} from './support.ts';

const calls = vi.hoisted(() => ({
  list: [] as { input: CallInput; result: CallResult }[],
  /** Replaces the outcomes of every call while set. */
  fake: null as null | ((input: CallInput) => CallResult),
  real: null as null | ((input: CallInput, rng: Parameters<typeof mc.scoreCalls>[1]) => CallResult),
}));

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  calls.real = real.scoreCalls;
  return {
    ...real,
    scoreCalls: (...args: Parameters<typeof real.scoreCalls>) => {
      const result = calls.fake === null ? real.scoreCalls(...args) : calls.fake(args[0]);
      calls.list.push({ input: args[0], result });
      return result;
    },
  };
});

beforeEach(() => {
  calls.list = [];
  calls.fake = null;
});

const SEED = 1_521_242_745;
const RANGE = UNDERCUT_CONFIG.defaults.undercutRangeMs;

/** The job's input on the view at the leader's lap `lap`, as the worker receives it. */
const inputOf = (lap: number = LAP, spec: UndercutViewSpec = {}): UndercutInput => structuredClone(UNDERCUT_JOB.prepare(undercutView(lap, spec)));

/** The input's starting point; fails the test without one. */
function startOf(input: UndercutInput) {
  const s = input.strategy.start;
  expect(s.known, json(s)).toBe(true);
  return s.known ? s.value : (undefined as never);
}

/** Car `car`'s value; fails the test when it is unknown or absent. */
function valueOf(out: UndercutOutput, car: CarId): Undercut {
  const v = out[car];
  expect(v?.known, `car ${car}: ${json(v)}`).toBe(true);
  return v!.known ? v!.value : (undefined as never);
}

const valueIn = <T>(k: Known<T>): T => {
  expect(k.known, json(k)).toBe(true);
  return k.known ? k.value : (undefined as never);
};

/** The recorded `scoreCalls` call of our car `car` (exactly one). */
function callOf(car: CarId): { input: CallInput; result: CallResult } {
  const mine = calls.list.filter((c) => c.input.car === car);
  expect(mine).toHaveLength(1);
  return mine[0]!;
}

/** The candidate (and its index) of rival `rival`'s case N on our lap `lap`. */
function caseIn(call: CallInput, rival: UndercutRival, lap: number, n: number): { c: CallCandidate; i: number } {
  const i = call.candidates.findIndex((c) => c.rival?.carId === rival.carId && c.rival.gapAtLap === lap + n + 1);
  expect(i, `rival ${rival.carId} N ${n}`).toBeGreaterThanOrEqual(0);
  return { c: call.candidates[i]!, i };
}

describe('undercut: the job', () => {
  // row 1
  it('rivals: the cars directly ahead and behind within 3.0 s, then the next each way within range, in place order', () => {
    for (const rangeMs of [RANGE, 4_500]) {
      const input = inputOf(LAP, { undercut: { undercutRangeMs: rangeMs } });
      const start = startOf(input);
      const out = run(input, createRng(SEED));
      let withNext = 0;
      for (const car of OURS) {
        const v = valueOf(out, car);
        const expected = expectedRivals(start, car, rangeMs);
        expect(expected.length, `car ${car} range ${rangeMs}`).toBeGreaterThanOrEqual(2);
        withNext += expected.length - 2;
        expect(v.carId).toBe(car);
        expect(v.rangeMs).toBe(rangeMs);
        expect(v.position).toBe([...start.order].indexOf(car) + 1);
        expect(v.lap).toBe(startLapOf(start, car));
        expect(v.rivals.map(({ carId, side, position, gapMs }) => ({ carId, side, position, gapMs }))).toEqual(expected);
      }
      // the wider range takes in the next car each way
      if (rangeMs > RANGE) expect(withNext).toBeGreaterThan(0);
    }
    // a rival is absent from the output
    expect(Object.keys(run(inputOf(), createRng(SEED))).map(Number).sort()).toEqual([...OURS].sort());
  }, 120_000);

  // row 2
  it('a rival ahead: we box now, it N laps later on its next compound; a rival behind: it boxes now, we N later', () => {
    const input = inputOf();
    const start = startOf(input);
    const out = run(input, createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(out, car);
      const { input: call } = callOf(car);
      const sol = solveDp(toDpInput(input.strategy, car));
      const { thresholds } = dpResult(sol);
      const ours = (stopLap: number) => {
        const plan = bestWith(sol, { stopLap, compound: 'best' });
        expect(plan, `bestWith stop ${stopLap}`).not.toBeNull();
        return policyOf(plan!, thresholds);
      };
      let cases = 0;
      expect(v.rivals.length).toBeGreaterThanOrEqual(2);
      for (const rival of v.rivals) {
        const next = rivalNextCompound(start, rival.carId);
        expect(next).not.toBeNull();
        expect(rival.cases.map((x) => x.n)).toEqual([1, 2, 3]);
        for (const { n } of rival.cases) {
          cases++;
          const { c } = caseIn(call, rival, v.lap, n);
          const later = v.lap + n;
          if (rival.side === 'ahead') {
            expect(c.policy).toEqual(ours(v.lap));
            expect(c.rival!.policy.stops).toEqual([{ lap: later, compound: next }]);
          } else {
            expect(c.policy).toEqual(ours(later));
            expect(c.rival!.policy.stops).toEqual([{ lap: v.lap, compound: next }]);
          }
          // the triggers come from policyOf: the DP's thresholds
          expect(c.policy.triggers).toEqual(thresholds);
          expect(c.rival!.gapAtLap).toBe(later + 1);
        }
      }
      // one call per car with every case; the cap split over them; strategy's hazard, aligned with the starting point
      expect(call.candidates).toHaveLength(cases);
      expect(call.scenarios).toBe(Math.floor(UNDERCUT_CONFIG.defaults.maxScenarioPolicies / cases));
      expect(call.hazard).toEqual(toMcHazard(input.strategy.hazard, start));
      expect(call.rivalRules).toEqual(mcSettingsFrom(input.strategy.config).rivalRules);
    }
  }, 120_000);

  // row 3
  it('gainMs is the gap change in our favour; aheadFromGainMs is +gap ahead, −gap behind; pAhead the share ending ahead', () => {
    // the pace replaced by known outcomes: per scenario the gap at gapAtLap is the current gap plus a known change
    const DELTAS = [3_000, 1_000, -1_500, 2_500, -4_200, 600, 4_400, -300];
    const gainsOf = (n: number) => Float64Array.from({ length: n }, (_, i) => DELTAS[i % DELTAS.length]!);
    calls.fake = (ci) => ({
      outcomes: ci.candidates.map((c) => {
        const n = ci.scenarios;
        const now = signedGap(ci.start, ci.car, c.rival!.carId);
        const gains = gainsOf(n);
        return {
          finish: new Int8Array(n).fill(4),
          rejoin: new Int8Array(n).fill(6),
          traffic: new Int8Array(n),
          gapMs: gains.map((g) => now + g),
          raceMs: new Float64Array(n).fill(1_000_000),
        };
      }),
    });
    const input = inputOf();
    const start = startOf(input);
    const out = run(input, createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(out, car);
      const { input: call } = callOf(car);
      const gains = gainsOf(call.scenarios);
      const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
      expect(v.rivals.length).toBeGreaterThanOrEqual(2);
      for (const rival of v.rivals) {
        const now = signedGap(start, car, rival.carId);
        expect(rival.side).toBe(now < 0 ? 'ahead' : 'behind');
        expect(rival.gapMs).toBeCloseTo(Math.abs(now), 6);
        expect(rival.aheadFromGainMs).toBeCloseTo(rival.side === 'ahead' ? rival.gapMs : -rival.gapMs, 6);
        expect(rival.cases.length).toBeGreaterThan(0);
        for (const x of rival.cases) {
          expect(valueIn(x.gainMs)).toBeCloseTo(mean, 6);
          const ahead = gains.filter((g) => now + g > 0).length / gains.length;
          expect(valueIn(x.pAhead)).toBeCloseTo(ahead, 9);
          // ending ahead is a gain above aheadFromGainMs
          expect(ahead).toBeCloseTo(gains.filter((g) => g > rival.aheadFromGainMs).length / gains.length, 9);
          const bins = binShares(gains, { from: UNDERCUT_GAIN_BINS.fromMs, step: UNDERCUT_GAIN_BINS.stepMs, count: UNDERCUT_GAIN_BINS.count });
          const got = valueIn(x.gainBins);
          expect(got).toHaveLength(UNDERCUT_GAIN_BINS.count);
          got.forEach((share, i) => expect(share, `bin ${i}`).toBeCloseTo(bins[i]!, 9));
        }
      }
    }
  }, 120_000);

  // row 4
  it("the box-now case's rejoin position is rejoin's green one (C43)", () => {
    const view = undercutView();
    const input = structuredClone(UNDERCUT_JOB.prepare(view));
    const out = run(input, createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(out, car);
      const { input: call, result } = callOf(car);
      const green = { known: true, value: GREEN_REJOIN[car], at: view.live.sessionTime };
      expect(v.rivals.some((r) => r.side === 'ahead' && r.cases.length > 0), `car ${car}: a rival ahead with cases`).toBe(true);
      for (const rival of v.rivals) {
        for (const x of rival.cases) {
          if (rival.side === 'ahead') {
            // we box now: rejoin's green position, not the simulated one
            expect(x.rejoinPosition).toEqual(green);
          } else {
            // we box N laps later: the median of the simulated rejoin
            const { i } = caseIn(call, rival, v.lap, x.n);
            const [lo, hi] = medianRange(result.outcomes[i]!.rejoin);
            const got = valueIn(x.rejoinPosition);
            expect(got).toBeGreaterThanOrEqual(lo);
            expect(got).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
  }, 120_000);

  // row 5
  it('a case past the last lap, a rival with no stop still ahead, or no set for us is absent', () => {
    const wide = { undercut: { undercutRangeMs: 60_000 } };

    // the last laps: every rival given a stop ahead; a case whose later stop leaves no lap to measure is absent
    const late = inputOf(18, wide);
    const lateStart = startOf(late);
    for (let k = 0; k < lateStart.cars; k++) if (!OURS.includes(k as CarId)) lateStart.stopLow[k] = lateStart.lap;
    const lateOut = run(late, createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(lateOut, car);
      expect(v.rivals.length).toBeGreaterThan(0);
      const fits = [1, 2, 3].filter((n) => v.lap + n + 1 <= lateStart.lapsTotal);
      expect(fits.length).toBeLessThan(3);
      for (const rival of v.rivals) expect(rival.cases.map((x) => x.n), `car ${car} rival ${rival.carId}`).toEqual(fits);
    }

    // a rival with no stop still ahead: no case for it; the others keep theirs
    const input = inputOf(LAP);
    const start = startOf(input);
    const base = valueOf(run(structuredClone(input), createRng(SEED)), PLAYER);
    const ahead = base.rivals.find((r) => r.side === 'ahead');
    expect(ahead).toBeDefined();
    start.stopLow[ahead!.carId] = start.lapsTotal;
    const without = valueOf(run(input, createRng(SEED)), PLAYER);
    expect(without.rivals.find((r) => r.carId === ahead!.carId)?.cases ?? []).toEqual([]);
    for (const r of without.rivals) if (r.carId !== ahead!.carId) expect(r.cases.length, `rival ${r.carId}`).toBeGreaterThan(0);

    // no set for us: no case, no throw
    const noSets = run(inputOf(LAP, { sets: { [PLAYER]: NO_SETS_LEFT, [TEAMMATE]: NO_SETS_LEFT } }), createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(noSets, car);
      expect(v.rivals.length).toBeGreaterThan(0);
      expect(v.rivals.flatMap((r) => r.cases)).toEqual([]);
    }
  }, 120_000);

  // row 6
  it('no rival in range: rivals empty, never notApplicable', () => {
    const input = inputOf(LAP, { undercut: { undercutRangeMs: 1 } });
    const start = startOf(input);
    const out = run(input, createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(out, car);
      expect(v.rivals).toEqual([]);
      expect(v.rangeMs).toBe(1);
      expect(v.position).toBe([...start.order].indexOf(car) + 1);
    }
  }, 120_000);

  // row 7
  it("agreement (spec §9.4): the box-now candidate's E[position] at its untilLap is within two MC errors of strategy's boxNow row's policy scored by scoreCalls over the same untilLap", () => {
    const input = inputOf();
    const out = run(structuredClone(input), createRng(SEED));
    for (const car of OURS) {
      const v = valueOf(out, car);
      const { input: call, result } = callOf(car);
      const rival = v.rivals.find((r) => r.side === 'ahead' && r.cases.some((x) => x.n === 1));
      expect(rival, `car ${car}: a rival ahead with N = 1`).toBeDefined();
      const { c, i } = caseIn(call, rival!, v.lap, 1);

      // strategy's boxNow row on the same input and seed: the DP's box-now play as strategy builds its policy
      const dp = dpResult(solveDp(toDpInput(input.strategy, car)));
      expect(dp.boxNow).not.toBeNull();
      // found by its stops, whatever triggers strategy gives it (non-best plans carry only the neutralised triggers)
      const boxNowStops = json(policyOf(dp.boxNow!, []).stops);
      const strategyRows = candidatesForRun(structuredClone(input.strategy), createRng(SEED)).perCar.get(car)?.candidates ?? [];
      const boxNowRow = strategyRows.find((r) => json(r.policy.stops) === boxNowStops);
      expect(boxNowRow, `car ${car}: strategy has the boxNow row`).toBeDefined();

      // scored by scoreCalls over the same horizon, against the same rival plan, on as many scenarios
      const real = calls.real!;
      const scored = real({ ...call, candidates: [{ policy: boxNowRow!.policy, rival: c.rival, untilLap: c.untilLap }] }, createRng(SEED));
      const a = meanSe(result.outcomes[i]!.finish);
      const b = meanSe(scored.outcomes[0]!.finish);
      const tieBand = mcSettingsFrom(input.strategy.config).tieBand;
      const tolerance = Math.max(2 * Math.hypot(a.se, b.se), tieBand);
      expect(Math.abs(a.mean - b.mean), `car ${car}: ${a.mean} vs ${b.mean}`).toBeLessThanOrEqual(tolerance);
    }
  }, 120_000);

  // row 12
  it('cases run to their untilLap, not the flag', () => {
    const input = inputOf();
    const start = startOf(input);
    run(input, createRng(SEED));
    for (const car of OURS) {
      const { input: call, result } = callOf(car);
      expect(call.candidates.length).toBeGreaterThan(0);
      for (const c of call.candidates) {
        // until both have stopped, plus one lap
        expect(c.untilLap).not.toBeNull();
        expect(c.untilLap).toBe(c.rival!.gapAtLap);
        const later = Math.max(c.policy.stops[0]!.lap, c.rival!.policy.stops[0]!.lap);
        expect(c.untilLap).toBe(later + 1);
        expect(c.untilLap!).toBeLessThanOrEqual(start.lapsTotal);
      }
      // the scenarios stop there: the race time at untilLap lies laps short of the same case run to the flag
      const first = call.candidates[0]!;
      const toFlag = calls.real!({ ...call, candidates: [{ ...first, untilLap: null }] }, createRng(SEED));
      // a retired car's raceMs is NaN: the mean skips it
      const finite = (xs: ArrayLike<number>) => Array.from(xs).filter(Number.isFinite);
      const short = meanSe(finite(result.outcomes[0]!.raceMs)).mean;
      const full = meanSe(finite(toFlag.outcomes[0]!.raceMs)).mean;
      const lapsShort = start.lapsTotal - first.untilLap!;
      expect(full - short, `car ${car}`).toBeGreaterThan(lapsShort * 50_000);
    }
  }, 120_000);
});
