// `pit-sweep`'s job (SP4.3b spec §9.2, §9.4; plan 4.3b2 Task 8 rows 1–4, 6–8; C2, C39, C43, C51): `prepare` on
// `strategy`'s small generator race seen from our two cars, `pit-window`'s and `rejoin`'s outputs set by the test, then
// `run` with a seeded generator. Every `solveDp` and `scoreCalls` call the job makes is recorded with the real simulator
// running, so the tests compare the rows with the candidates and outcomes they came from. How a run is read:
// `./support.ts`. Rows 5, 9, 10 and 12: the feature's tests (`apps/bridge/test/features/pit-sweep/`); row 11:
// `pit-sweep.budget.test.ts`.
import { known, unknown, type CarId, type NoiseCompound, type PitSweepCar, type PitSweepTable } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type * as dp from '../../src/strategy-dp/index.ts';
import { paired, ties } from '../../src/race-monte-carlo/index.ts';
import { bestWith, dpResult } from '../../src/strategy-dp/index.ts';
import { PIT_SWEEP_CONFIG, PIT_SWEEP_JOB } from '../../src/pit-sweep/index.ts';
import { run } from '../../src/pit-sweep/job.ts';
import { placePmf } from '../../src/shared/distribution.ts';
import { mcSettingsFrom, policyOf } from '../../src/shared/strategy-input/index.ts';
import { prepareStrategy, runStrategy } from '../../src/strategy/index.ts';
import { viewAt } from '../strategy/support.ts';
import { json, mean, middles, OURS, pitWindowOf, PLAYER, RACE, seOf, SETS, SWEEP_CAP, sweepViewAt, TEAMMATE, windowOf, type Recorded, type SweepSpec } from './support.ts';

const rec = vi.hoisted(() => ({ dp: [], calls: [] }) as Recorded);

vi.mock('../../src/strategy-dp/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof dp>();
  return {
    ...real,
    solveDp: (...args: Parameters<typeof real.solveDp>) => {
      const solution = real.solveDp(...args);
      rec.dp.push({ input: args[0], solution });
      return solution;
    },
  };
});

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    scoreCalls: (...args: Parameters<typeof real.scoreCalls>) => {
      const result = real.scoreCalls(...args);
      rec.calls.push({ input: args[0], result });
      return result;
    },
  };
});

beforeEach(() => {
  rec.dp = [];
  rec.calls = [];
});

const SEED = 913_402_117;
/** Row 7's cap: the smallest that agrees with `strategy` over as many seeds as the production-scale 4,000 did (Task 18p: seeds 1–7 and SEED). */
const AGREEMENT_CAP = 400;
const LAP = 3;
/** Task 18q (Q10): the rows run from the window's `from − ROWS_BEFORE` to its `to + ROWS_AFTER` (config `rowsBefore`, `rowsAfter`). */
const ROWS_BEFORE = 3;
const ROWS_AFTER = 8;

/** The stop laps a compound's rows may cover (Task 18q): `[max(now, from − rowsBefore), min(flag − 1, to + rowsAfter)]`; every stop lap without a window. */
function rowRange(now: number, flag: number, window: { from: number; to: number } | undefined, before = ROWS_BEFORE, after = ROWS_AFTER): [number, number] {
  if (window === undefined) return [now, flag - 1];
  return [Math.max(now, window.from - before), Math.min(flag - 1, window.to + after)];
}

/** The job's output on the race's view at the leader's lap `lap`, as the worker computes it. */
function swept(spec: SweepSpec = {}, lap = LAP, seed = SEED): ReturnType<typeof run> {
  const input = structuredClone(PIT_SWEEP_JOB.prepare(sweepViewAt(RACE(), lap, spec)));
  return run(input, createRng(seed));
}

/** Car `car`'s sweep; fails the test when it has none. */
function carOf(out: ReturnType<typeof run>, car: CarId): PitSweepCar {
  const c = out[car];
  expect(c, `car ${car}: ${json(out)}`).toBeDefined();
  return c!;
}

/** Car `car`'s table of `compound`; fails the test when it has none. */
function tableOf(c: PitSweepCar, compound: NoiseCompound): PitSweepTable {
  const t = c.byCompound[compound];
  expect(t?.known, `car ${c.carId} ${compound}: ${json(t)}`).toBe(true);
  return t!.known ? t!.value : (undefined as never);
}

/** The recorded DP solve of car `car` (exactly one, spec §9: one solve per car). */
function solveOf(car: CarId) {
  const solves = rec.dp.filter((d) => d.input.car === car);
  expect(solves, `car ${car}'s DP solves`).toHaveLength(1);
  return solves[0]!;
}

/** The recorded `scoreCalls` call of car `car` whose candidates box first onto `compound`. */
function callOf(car: CarId, compound: NoiseCompound) {
  const calls = rec.calls.filter((c) => c.input.car === car && c.input.candidates[0]?.policy.stops[0]?.compound === compound);
  expect(calls, `car ${car} ${compound}: its scoreCalls calls`).toHaveLength(1);
  return calls[0]!;
}

/** The stop laps L from `first` (default now) to `last` whose `bestWith` gives a plan, and those plans' policies. */
function expectedCandidates(car: CarId, compound: NoiseCompound, last: number, first?: number) {
  const { input, solution } = solveOf(car);
  const thresholds = dpResult(solution).thresholds;
  const out: { lap: number; policy: ReturnType<typeof policyOf> }[] = [];
  for (let lap = first ?? input.fromLap; lap <= last; lap++) {
    const plan = bestWith(solution, { stopLap: lap, compound });
    if (plan !== null) out.push({ lap, policy: policyOf(plan, thresholds) });
  }
  return out;
}

const SWEPT: readonly NoiseCompound[] = ['hard', 'medium', 'soft'];

describe('pit-sweep: the job', () => {
  // row 1
  it('one table per compound with a new set; auto is pit-window\'s windowCompound; a superSoft or unknown set has no table', () => {
    const out = swept({ window: { compounds: ['soft', 'medium', 'hard', 'superSoft', 'unknown'] } });
    for (const car of OURS) {
      const c = carOf(out, car);
      expect(Object.keys(c.byCompound).sort(), `car ${car}`).toEqual([...SWEPT]);
      for (const compound of SWEPT) expect(tableOf(c, compound).compound).toBe(compound);
      expect(c.auto).toMatchObject({ known: true, value: 'hard' });
    }
    // only our cars: a rival is absent
    expect(Object.keys(out).map(Number).sort()).toEqual([...OURS].sort());

    // an auto that resolves to a compound without a NoiseCompound: insufficientData (plan Global Constraints, P28)
    const superSoft = swept({ window: { compounds: ['hard'], windowCompound: known('superSoft', 0) } });
    for (const car of OURS) expect(carOf(superSoft, car).auto).toEqual(unknown('insufficientData'));
    // pit-window's windowCompound unknown: auto carries its reason
    const none = swept({ window: { compounds: ['hard'], windowCompound: unknown('notApplicable') } });
    for (const car of OURS) {
      expect(carOf(none, car).auto).toEqual(unknown('notApplicable'));
      // the tables are swept whatever auto is
      tableOf(carOf(none, car), 'hard');
    }
  });

  // row 2 (ported in Task 18q: the rows span the window's range, 18q rows 3–4, instead of now to stint.latest + pastLifeLaps)
  it('rows over the window\'s range, each "box at L onto the compound, then bestWith"', () => {
    const flag = RACE().laps;
    for (const latestIn of [5, null]) {
      rec.dp = [];
      rec.calls = [];
      const view = sweepViewAt(RACE(), LAP, { window: { latestIn } });
      const out = run(structuredClone(PIT_SWEEP_JOB.prepare(view)), createRng(SEED));
      for (const car of OURS) {
        const c = carOf(out, car);
        const now = solveOf(car).input.fromLap;
        expect(c.lap, `car ${car}: lap is now`).toBe(now);
        expect(c.position).toBe(view.live.cars.find((x) => x.id === car)!.timing.position);
        for (const compound of SWEPT) {
          // the window unknown (stint.latest unknown): every stop lap to flag − 1
          const [first, last] = rowRange(now, flag, windowOf(view, car, compound, { latestIn }));
          const t = tableOf(c, compound);
          const expected = expectedCandidates(car, compound, last, first);
          expect(expected.length, `car ${car} ${compound}`).toBeGreaterThan(0);
          expect(t.rows.map((r) => r.stopLap), `car ${car} ${compound}, latest ${latestIn}`).toEqual(expected.map((e) => e.lap));
          // the default window opens 3 laps from now: the first row is now
          expect(t.rows[0]!.stopLap).toBe(now);

          const { input, result } = callOf(car, compound);
          expect(input.candidates.map((x) => x.policy), `car ${car} ${compound}`).toEqual(expected.map((e) => e.policy));
          for (const x of input.candidates) expect(x).toMatchObject({ rival: null, untilLap: null });
          const scenarios = Math.floor(SWEEP_CAP / expected.length);
          expect(input.scenarios).toBe(scenarios);
          expect(t.scenarios).toBe(scenarios);
          expect(input.traffic).toEqual({ gapMs: PIT_SWEEP_CONFIG.defaults.trafficGapMs, laps: PIT_SWEEP_CONFIG.defaults.trafficLaps });

          // each row's numbers from its candidate's outcomes
          t.rows.forEach((row, i) => {
            const o = result.outcomes[i]!;
            const where = `car ${car} ${compound} L${row.stopLap}`;
            expect(row.ePos, where).toBeCloseTo(mean(o.finish), 9);
            expect(row.positionPmf, where).toEqual(placePmf(o.finish, input.start.cars));
            expect(row.pGain, where).toBeCloseTo(Array.from(o.finish).filter((p) => p < c.position).length / o.finish.length, 9);
            expect(row.meanMs, where).toBeCloseTo(mean(Array.from(o.raceMs).filter(Number.isFinite)), 3);
            const [tLo, tHi] = middles(o.traffic);
            expect(row.traffic.known && row.traffic.value >= tLo && row.traffic.value <= tHi, `${where} traffic ${json(row.traffic)}`).toBe(true);
            if (latestIn === null) expect(row.pastLife, where).toMatchObject({ known: false });
          });
        }
        // one call per compound
        expect(rec.calls.filter((x) => x.input.car === car)).toHaveLength(SWEPT.length);
      }
    }
  });

  // row 3
  it('inWindow marks the rows within the tie test of the best; pastLife the stops after stint.latest; the builder race has at least one pastLife row', () => {
    const view = sweepViewAt(RACE(), LAP, { window: { latestIn: 5 } });
    const input = PIT_SWEEP_JOB.prepare(view);
    const { zTie, tieBand } = mcSettingsFrom(view.config);
    const out = run(structuredClone(input), createRng(SEED));
    for (const car of OURS) {
      const c = carOf(out, car);
      const latest = c.lap + 5;
      let pastLifeRows = 0;
      for (const compound of SWEPT) {
        const t = tableOf(c, compound);
        const { result } = callOf(car, compound);
        const finish = result.outcomes.map((o) => Float64Array.from(o.finish));
        const best = t.rows.reduce((b, r, i) => (r.ePos < t.rows[b]!.ePos ? i : b), 0);
        t.rows.forEach((row, i) => {
          const where = `car ${car} ${compound} L${row.stopLap}`;
          expect(row.inWindow, where).toBe(ties(paired(finish[best]!, finish[i]!), zTie, tieBand));
          expect(row.pastLife, where).toMatchObject({ known: true, value: row.stopLap > latest });
          if (row.stopLap > latest) pastLifeRows++;
        });
        expect(t.rows[best]!.inWindow, `car ${car} ${compound}: the best row is in the window`).toBe(true);
      }
      expect(pastLifeRows, `car ${car}`).toBeGreaterThan(0);
    }
  });

  // row 4
  it('a compound without a new set or with no row left: absent from byCompound', () => {
    // pit-window names soft, medium and hard; we have no new soft (the DP's sets): no soft row can be made
    const noSoft = SETS.filter((s) => s.visualCompound !== 'soft' || s.fitted);
    const a = swept({ sets: { [PLAYER]: noSoft, [TEAMMATE]: noSoft }, window: { compounds: ['soft', 'medium', 'hard'] } });
    // pit-window names no hard: no hard table
    const b = swept({ window: { compounds: ['soft', 'medium'] } });
    for (const car of OURS) {
      expect(Object.keys(carOf(a, car).byCompound).sort(), `car ${car}, no new soft`).toEqual(['hard', 'medium']);
      expect(Object.keys(carOf(b, car).byCompound).sort(), `car ${car}, pit-window without hard`).toEqual(['medium', 'soft']);
    }
    // no row left: the window's end plus rowsAfter lies behind now (ported in Task 18q from stint.latest + pastLifeLaps), or the last lap
    const passed = swept({ window: { latestIn: -(ROWS_AFTER + 1) } });
    const lastLap = swept({ window: { latestIn: null } }, RACE().laps);
    for (const car of OURS) {
      expect(carOf(passed, car).byCompound, `car ${car}, past the window's end + rowsAfter`).toEqual({});
      expect(carOf(passed, car).auto).toMatchObject({ known: true, value: 'hard' });
      expect(carOf(lastLap, car).byCompound, `car ${car}, the last lap`).toEqual({});
    }
  });

  // Task 18q row 3
  it('rows run from max(now, earliest − 3) to min(last − 1, latest + 8); with the window unknown, every stop lap', () => {
    expect(PIT_SWEEP_CONFIG.defaults, 'the config\'s rowsBefore and rowsAfter (Q10)').toMatchObject({ rowsBefore: ROWS_BEFORE, rowsAfter: ROWS_AFTER });
    const flag = RACE().laps;
    // soft, medium and hard: windows of their own (soft opens later), stint.latest 6 laps on; or hard's set does not
    // reach the flag (windowLaps notApplicable); or stint.latest unknown (every window unknown); or the config's own bounds
    const cases: [string, SweepSpec, number, number][] = [
      ['windows', { window: { latestIn: 6, earliestIn: 5, earliestBy: { soft: 6 } } }, ROWS_BEFORE, ROWS_AFTER],
      ['hard without a window', { window: { latestIn: 6, earliestIn: 5, noWindow: ['hard'] } }, ROWS_BEFORE, ROWS_AFTER],
      ['stint.latest unknown', { window: { latestIn: null, earliestIn: 5 } }, ROWS_BEFORE, ROWS_AFTER],
      ['rowsBefore 1, rowsAfter 2', { window: { latestIn: 6, earliestIn: 5 }, sweepConfig: { rowsBefore: 1, rowsAfter: 2 } }, 1, 2],
    ];
    for (const [name, spec, before, after] of cases) {
      rec.dp = [];
      rec.calls = [];
      const view = sweepViewAt(RACE(), LAP, spec);
      const out = run(structuredClone(PIT_SWEEP_JOB.prepare(view)), createRng(SEED));
      for (const car of OURS) {
        const c = carOf(out, car);
        const now = solveOf(car).input.fromLap;
        for (const compound of SWEPT) {
          const window = windowOf(view, car, compound, spec.window);
          const [first, last] = rowRange(now, flag, window, before, after);
          const where = `${name}: car ${car} ${compound}, window ${json(window)}, rows L${first}–L${last}`;
          if (name === 'windows') expect(first, `${where}: the window sets the first row`).toBeGreaterThan(now);
          if (name === 'windows') expect(last, `${where}: the window sets the last row`).toBeLessThan(flag - 1);
          if (window === undefined) expect([first, last], where).toEqual([now, flag - 1]);
          const expected = expectedCandidates(car, compound, last, first);
          expect(expected.length, where).toBeGreaterThan(0);
          const t = tableOf(c, compound);
          expect(t.rows.map((r) => r.stopLap), where).toEqual(expected.map((e) => e.lap));
          const { input } = callOf(car, compound);
          expect(input.candidates.map((x) => x.policy), where).toEqual(expected.map((e) => e.policy));
          // the cap shared by the compound's rows
          expect(t.scenarios, where).toBe(Math.floor(SWEEP_CAP / expected.length));
        }
      }
    }
  });

  // Task 18q row 4
  it('a window near the end clips at the last lap − 1; near now, at now', () => {
    const flag = RACE().laps;
    const view = sweepViewAt(RACE(), LAP);
    for (const car of OURS) {
      const current = pitWindowOf(view, car).currentLap;

      // near the end: hard's window L(flag − 4)–L(flag − 2), so latest + 8 lies past the flag
      rec.dp = [];
      rec.calls = [];
      const end: SweepSpec = { window: { compounds: ['hard'], latestIn: flag - 2 - current, earliestIn: flag - 4 - current } };
      expect(windowOf(view, car, 'hard', end.window), `car ${car}: hard's window`).toEqual({ from: flag - 4, to: flag - 2 });
      const atEnd = tableOf(carOf(swept(end), car), 'hard').rows.map((r) => r.stopLap);
      const now = solveOf(car).input.fromLap;
      const first = flag - 4 - ROWS_BEFORE;
      expect(first, `car ${car}: the window's start − 3 lies after now`).toBeGreaterThan(now);
      expect(atEnd, `car ${car}, near the end: L${first} to L${flag - 1}`).toEqual(expectedCandidates(car, 'hard', flag - 1, first).map((e) => e.lap));
      expect(atEnd.at(-1), `car ${car}: never past the last lap − 1`).toBeLessThanOrEqual(flag - 1);

      // near now: hard's window opens next lap, so earliest − 3 lies before now
      rec.dp = [];
      rec.calls = [];
      const near: SweepSpec = { window: { compounds: ['hard'], latestIn: 3, earliestIn: 1 } };
      const atNow = tableOf(carOf(swept(near), car), 'hard').rows.map((r) => r.stopLap);
      const nowNear = solveOf(car).input.fromLap;
      const last = Math.min(flag - 1, current + 3 + ROWS_AFTER);
      expect(atNow[0], `car ${car}: the first row is now`).toBe(nowNear);
      expect(atNow, `car ${car}, near now: L${nowNear} to L${last}`).toEqual(expectedCandidates(car, 'hard', last, nowNear).map((e) => e.lap));
    }
  });

  // row 6
  it('the row at L = now takes rejoin\'s green rejoin position (C43)', () => {
    const cars = RACE().viewAt(1).live.cars.length;
    for (const green of [1, cars]) {
      rec.calls = [];
      const out = swept({ window: { compounds: ['hard'] }, greenRejoin: { [PLAYER]: green, [TEAMMATE]: green } });
      for (const car of OURS) {
        const t = tableOf(carOf(out, car), 'hard');
        expect(t.rows[0]!.rejoinPosition, `car ${car}, green ${green}`).toMatchObject({ known: true, value: green });
        // a later stop: the simulated rejoin, the median over the scenarios
        const { result } = callOf(car, 'hard');
        t.rows.slice(1).forEach((row, i) => {
          const [lo, hi] = middles(result.outcomes[i + 1]!.rejoin);
          expect(row.rejoinPosition.known && row.rejoinPosition.value >= lo && row.rejoinPosition.value <= hi, `car ${car} L${row.stopLap}: ${json(row.rejoinPosition)}`).toBe(true);
        });
      }
    }
  });

  // row 7
  it('agreement (spec §9.4): the row at strategy\'s best stop lap has its E[position] within their two MC errors', () => {
    const strategy = runStrategy(structuredClone(prepareStrategy(viewAt(RACE(), LAP))), createRng(SEED));
    for (const car of OURS) {
      const s = strategy[car];
      expect(s?.known, `car ${car}: ${json(s)}`).toBe(true);
      const { rows, scenarios } = s!.known ? s!.value : (undefined as never);
      const best = rows[0]!;
      const stop = best.policy.stops[0];
      expect(stop, `car ${car}: strategy's best stops`).toBeDefined();
      const compound = stop!.compound as NoiseCompound;
      const sePmf = Math.sqrt(best.positionPmf.reduce((a, p, i) => a + p * (i + 1 - best.ePos) ** 2, 0) / scenarios);

      rec.calls = [];
      rec.dp = [];
      const out = swept({ window: { compounds: [compound], latestIn: null }, sweepConfig: { maxScenarioPolicies: AGREEMENT_CAP } }, LAP, SEED);
      const t = tableOf(carOf(out, car), compound);
      const i = t.rows.findIndex((r) => r.stopLap === stop!.lap);
      expect(i, `car ${car}: a row at strategy's stop lap ${stop!.lap}`).toBeGreaterThanOrEqual(0);
      const seRow = seOf(callOf(car, compound).result.outcomes[i]!.finish);
      const diff = Math.abs(t.rows[i]!.ePos - best.ePos);
      expect(diff, `car ${car}: sweep ${t.rows[i]!.ePos.toFixed(3)} ± ${seRow.toFixed(3)}, strategy ${best.ePos.toFixed(3)} ± ${sePmf.toFixed(3)}`).toBeLessThanOrEqual(
        2 * Math.hypot(seRow, sePmf),
      );
    }
  });

  // row 8
  it('the same jobSeed gives a bit-identical output', () => {
    const input = PIT_SWEEP_JOB.prepare(sweepViewAt(RACE(), LAP));
    expect(structuredClone(input)).toEqual(input);
    const a = run(structuredClone(input), createRng(SEED));
    const b = run(structuredClone(input), createRng(SEED));
    expect(b).toStrictEqual(a);
    expect(json(b)).toBe(json(a));
    // no state between runs (C31, C32): another run in between changes nothing
    swept({}, 8);
    expect(run(structuredClone(input), createRng(SEED))).toStrictEqual(a);
  });
});
