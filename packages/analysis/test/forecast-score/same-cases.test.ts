// `forecast-score`'s like-for-like scores (SP4.3b1 Task 27; C3, C51): the point forecast is scored on every forecast
// case from `minPredictLap`, the Monte Carlo's CRPS only at the predict laps every `crpsEveryLaps` from `crpsFirstLap`,
// so the two tables' means come from different cases. `sameCases` holds, per horizon, basis and driver type, the CRPS,
// the point forecast's and the baseline's ("gaps stay") mean absolute position error over exactly the cases that have
// both a CRPS score and a point score. A point forecast is a pmf of mass 1 at its place: its CRPS is its absolute error,
// so the three numbers compare.
import type { CarId, ForecastScoreReport, Summary } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rankedProbabilityScore } from '../../src/forecast-score/crps.ts';
import { forecastCases, type ForecastCase, type Horizon } from '../../src/forecast-score/forecasts.ts';
import { run, type ScoreInput } from '../../src/forecast-score/job.ts';
import type * as fieldModule from '../../src/race-monte-carlo/field.ts';
import { fieldPositions } from '../../src/race-monte-carlo/field.ts';
import type { FieldInput, FieldResult } from '../../src/race-monte-carlo/types.ts';
import { CONFIG, generated, inputAt, SMALL } from './support.ts';

// Every `fieldPositions` run of the job, through to the real simulator.
vi.mock('../../src/race-monte-carlo/field.ts', async (original) => {
  const m = await original<typeof fieldModule>();
  return { ...m, fieldPositions: vi.fn(m.fieldPositions) };
});
const field = vi.mocked(fieldPositions);
beforeEach(() => {
  field.mockClear();
});

const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];
const DRIVERS = ['ai', 'human'] as const;
type Driver = (typeof DRIVERS)[number];
/** The small generator race's human cars (support.ts `SMALL`). */
const HUMANS = new Set([6, 7]);
/** Fewer scenarios than the default 200, for speed. */
const SCENARIOS = 60;

type Forecast = ForecastScoreReport['forecasts'][number];

/** `input` with `forecast-score`'s config merged with `over` (and `SCENARIOS`). */
const configured = (input: ScoreInput, over: Partial<typeof CONFIG> = {}): ScoreInput => ({
  ...input,
  config: { ...input.config, 'forecast-score': { ...input.config['forecast-score'], crpsScenarios: SCENARIOS, ...over } },
});

/** The predict lap of a `fieldPositions` run: its first lap is predict lap + 1 (horizon 1). */
const predictLapOf = (call: FieldInput) => Math.min(...call.laps) - 1;

/** A case's key within one horizon and basis: its car and predict lap. */
const keyOf = (carId: CarId | number, lap: number) => `${carId}:${lap}`;

/**
 * The CRPS scores the job computed, recomputed from its `fieldPositions` runs: per horizon and basis, the key of every
 * CRPS case at the run's predict laps that has a pmf at its target lap, with its score and driver type.
 */
function crpsScores(input: ScoreInput, firstLap: number, everyLaps: number): Map<string, Map<string, { score: number; driver: Driver }>> {
  const calls = field.mock.calls.map(([call]) => call);
  const results = field.mock.results.map((r) => r.value as FieldResult);
  const byLap = new Map(calls.map((call, i) => [predictLapOf(call), { call, result: results[i]! }]));
  const out = new Map<string, Map<string, { score: number; driver: Driver }>>();
  const cases: ForecastCase[] = forecastCases(input.history, HORIZONS, firstLap).filter((c) => (c.lap - firstLap) % everyLaps === 0);
  for (const c of cases) {
    const r = byLap.get(c.lap);
    if (r === undefined) continue;
    const pmf = r.result.positionPmf[c.carId]?.[r.call.laps.indexOf(c.targetLap)];
    if (pmf === undefined) continue;
    const table = `h${c.horizon}.${c.basis}`;
    let of = out.get(table);
    if (of === undefined) out.set(table, (of = new Map()));
    of.set(keyOf(c.carId, c.lap), { score: rankedProbabilityScore(pmf, c.actualPosition), driver: HUMANS.has(c.carId) ? 'human' : 'ai' });
  }
  return out;
}

/** `ForecastScoreReport.forecasts[].sameCases` (domain, 614057f9). */
const sameOf = (f: Forecast): Forecast['sameCases'] => {
  expect(f.sameCases, `h${f.horizon} ${f.basis}: sameCases`).toBeDefined();
  return f.sameCases;
};

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** `summary` has `n` cases and, with any, the mean `expected`; without, an unknown mean (C3). */
function expectSummary(summary: Summary, n: number, expected: number, label: string) {
  expect(summary.n, `${label}: n`).toBe(n);
  if (n === 0) {
    expect(summary.meanAbs, `${label}: mean`).toEqual({ known: false, reason: 'insufficientData' });
    return;
  }
  expect(summary.meanAbs.known, `${label}: mean known`).toBe(true);
  if (summary.meanAbs.known) expect(summary.meanAbs.value, `${label}: mean`).toBeCloseTo(expected, 9);
}

describe('forecast-score sameCases', () => {
  it('sameCases holds, per horizon, basis and driver type, the CRPS and the point and baseline mean abs position error over the same cases, all with the same n', () => {
    // The small generator race: 8 cars (6 and 7 human), 20 laps, one stop each on laps 8 to 10; CRPS at laps 2, 7, 12, 17.
    const input = configured(inputAt(generated()));
    const report = run(input, createRng(0));
    const crps = crpsScores(input, CONFIG.crpsFirstLap, CONFIG.crpsEveryLaps);

    let shared = 0;
    for (const f of report.forecasts) {
      const same = sameOf(f);
      const scores = crps.get(`h${f.horizon}.${f.basis}`) ?? new Map();
      const baseline = new Map(f.baselinePosition.cases.map((c) => [keyOf(c.carId, c.lap), c]));
      for (const driver of DRIVERS) {
        const label = `h${f.horizon} ${f.basis} ${driver}`;
        // the cases of this driver type with a point score and a CRPS score
        const point = f.position.cases.filter((c) => c.driver === driver && scores.has(keyOf(c.carId, c.lap)));
        const n = point.length;
        shared += n;
        expectSummary(same.crps[driver], n, mean(point.map((c) => scores.get(keyOf(c.carId, c.lap))!.score)), `${label} crps`);
        expectSummary(same.position[driver], n, mean(point.map((c) => Math.abs(c.error))), `${label} point`);
        expectSummary(same.baseline[driver], n, mean(point.map((c) => Math.abs(baseline.get(keyOf(c.carId, c.lap))!.error))), `${label} baseline`);
        // all three over the same cases
        expect(same.position[driver].n, label).toBe(same.crps[driver].n);
        expect(same.baseline[driver].n, label).toBe(same.crps[driver].n);
      }
    }
    // shared cases exist, AI and human
    expect(shared).toBeGreaterThan(0);
    expect(report.forecasts.some((f) => sameOf(f).crps.human.n > 0)).toBe(true);
    expect(report.forecasts.some((f) => sameOf(f).crps.ai.n > 0)).toBe(true);
  });

  it('a case is in sameCases only if it has both a CRPS score and a point score (a CRPS predict lap whose case the point scoring left out is not)', () => {
    // The CRPS starts at leader lap 2, the point tables at lap 3 (`minPredictLap`): lap 2's CRPS cases have no point
    // score. The point scoring also leaves out a case whose car's own forecast policy stops within the horizon, which
    // the CRPS keeps: car 3 (AI) never stops, so rival-stops predicts its overdue stop (as own-predicted-stop.test.ts).
    expect(CONFIG.crpsFirstLap).toBeLessThan(CONFIG.minPredictLap);
    const params = { ...SMALL, field: SMALL.field.map((car, i) => (i === 3 ? { ...car, stops: [] } : car)) };
    const input = configured(inputAt(generated(params)));
    const report = run(input, createRng(0));
    const crps = crpsScores(input, CONFIG.crpsFirstLap, CONFIG.crpsEveryLaps);

    let leftOut = 0;
    let leftOutLap2 = 0;
    for (const f of report.forecasts) {
      const same = sameOf(f);
      const scores = crps.get(`h${f.horizon}.${f.basis}`) ?? new Map();
      const points = new Set(f.position.cases.map((c) => keyOf(c.carId, c.lap)));
      for (const driver of DRIVERS) {
        const withCrps = [...scores].filter(([, s]) => s.driver === driver);
        // the report's CRPS counts every CRPS case; sameCases only those with a point score
        expect(f.crps[driver].n, `h${f.horizon} ${f.basis} ${driver}: crps n`).toBe(withCrps.length);
        const withoutPoint = withCrps.filter(([key]) => !points.has(key));
        leftOut += withoutPoint.length;
        leftOutLap2 += withoutPoint.filter(([key]) => key.endsWith(':2')).length;
        expect(same.crps[driver].n, `h${f.horizon} ${f.basis} ${driver}: sameCases n`).toBe(withCrps.length - withoutPoint.length);
      }
    }
    expect(leftOutLap2).toBeGreaterThan(0);
    expect(leftOut).toBeGreaterThan(leftOutLap2);
  });

  it('a point forecast given as a pmf of mass 1 at its position scores a CRPS equal to its absolute error', () => {
    for (const places of [1, 3, 8, 20]) {
      for (let predicted = 1; predicted <= places; predicted++) {
        const pmf = Array.from({ length: places }, (_, k) => (k + 1 === predicted ? 1 : 0));
        for (let actual = 1; actual <= places; actual++) {
          expect(rankedProbabilityScore(pmf, actual), `${places} places, P${predicted} for P${actual}`).toBeCloseTo(Math.abs(actual - predicted), 12);
        }
      }
    }
  });

  it("with no shared case every sameCases summary has n 0 and meanAbs unknown('insufficientData'), never 0", () => {
    // One CRPS predict lap only, lap 2, before the point tables' first predict lap 3: no case has both scores.
    const input = configured(inputAt(generated()), { crpsFirstLap: 2, crpsEveryLaps: 100 });
    const report = run(input, createRng(0));
    // the two tables each have cases, none shared
    expect(report.forecasts.some((f) => f.crps.ai.n + f.crps.human.n > 0)).toBe(true);
    expect(report.forecasts.some((f) => f.position.ai.n + f.position.human.n > 0)).toBe(true);
    for (const f of report.forecasts) {
      const same = sameOf(f);
      for (const part of ['crps', 'position', 'baseline'] as const) {
        for (const driver of DRIVERS) {
          const s = same[part][driver];
          expect(s.n, `h${f.horizon} ${f.basis} ${part} ${driver}`).toBe(0);
          expect(s.meanAbs, `h${f.horizon} ${f.basis} ${part} ${driver}`).toEqual({ known: false, reason: 'insufficientData' });
        }
      }
    }
  });
});
