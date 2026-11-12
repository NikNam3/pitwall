// `forecast-score`'s job (SP4.3a spec 7.1, plan Task 19 rows 1, 5, 7 and 10; C51): its declaration, `prepare` as the
// worker receives it, and the scoreboard `run` gives on generator races: every case predicted against actual, every
// table split AI and human by the car-driver span at the case's frame (C26).
import type { ScoreTable } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { naturalExperiments } from '../../src/forecast-score/experiments.ts';
import { forecastCases } from '../../src/forecast-score/forecasts.ts';
import { FORECAST_SCORE, FORECAST_SCORE_JOB } from '../../src/forecast-score/index.ts';
import * as jobModule from '../../src/forecast-score/job.ts';
import { prepareScore, run } from '../../src/forecast-score/job.ts';
import { CONFIG, generated, inputAt, SMALL, viewOf } from './support.ts';

const HUMANS = new Set([6, 7]);

/** Every table of the report. */
const tablesOf = (report: ReturnType<typeof run>): ScoreTable[] => [
  report.experiments.rejoin,
  report.experiments.undercut,
  report.experiments.scStop,
  ...report.forecasts.flatMap((f) => [f.lapTime, f.position, f.baselinePosition]),
];

/** Computed once, on first use (a throw fails the test that asked, not the file). */
const once = <T>(f: () => T): (() => T) => {
  let v: { value: T } | undefined;
  return () => (v ??= { value: f() }).value;
};

const race = generated();
const inputOnce = once(() => inputAt(race));
const reportOnce = once(() => run(inputOnce(), createRng(0)));

describe('forecast-score job', () => {
  it('is a C51 job: id, reads, the leader-lap trigger, a module exporting run', () => {
    expect(FORECAST_SCORE_JOB).toMatchObject({ kind: 'job', id: FORECAST_SCORE, trigger: 'leaderLap' });
    expect(FORECAST_SCORE_JOB.reads).toEqual(expect.arrayContaining(['laps', 'stints', 'pitStops', 'miniSectors', 'events', 'decisions', 'drivers', 'spans:car-driver', 'spans:session-phase-race', 'spans:weekend-phase']));
    expect(FORECAST_SCORE_JOB.module.href).toBe(new URL('../../src/forecast-score/job.ts', import.meta.url).href);
    expect(typeof jobModule.run).toBe('function');
  });

  it('prepare gives a structured-cloneable input: the projection with its append frames, the run fixed inputs', () => {
    const view = viewOf(race);
    const prepared = prepareScore(view);
    expect(structuredClone(prepared)).toEqual(prepared);
    expect(prepared.history.appendedAt).toEqual(view.history.appendedAt);
    expect(prepared.history.laps).toEqual(view.history.laps);
    expect(prepared.track).toEqual(view.track);
    expect(prepared.drivers).toEqual(view.drivers);
  });

  it('rejoin case on a builder stop: predicted vs actual position (scored)', () => {
    const [input, report] = [inputOnce(), reportOnce()];
    const cases = naturalExperiments(input.history, CONFIG).rejoin;
    const table = report.experiments.rejoin;
    expect(table.unit).toBe('places');
    // One case per stop: every car stops once, green.
    expect(table.cases).toHaveLength(cases.length);
    expect(cases).toHaveLength(SMALL.cars);
    for (const c of table.cases) {
      expect(c.error, `car ${c.carId}`).toBe(c.actual - c.predicted);
      expect(c.actual, `car ${c.carId}`).toBe(cases.find((k) => k.carId === c.carId)!.measure(input.history));
    }
  });

  it('forecast horizons 1, 3, 5, 10 with the gaps-stay baseline (scored)', () => {
    const [input, report] = [inputOnce(), reportOnce()];
    expect([...new Set(report.forecasts.map((f) => f.horizon))].sort((a, b) => a - b)).toEqual([1, 3, 5, 10]);
    const cases = forecastCases(input.history, [1, 3, 5, 10]);
    for (const f of report.forecasts) {
      expect(f.lapTime.unit).toBe('ms');
      expect(f.position.unit).toBe('places');
      const of = cases.filter((c) => c.horizon === f.horizon && c.basis === f.basis);
      // Ported in Task 11g: the job also leaves out a case whose horizon holds a stop of the car's own predicted policy
      // (own-predicted-stop.test), so its tables hold a subset of the forecast cases, each table the same cases.
      expect(f.position.cases.length, `h ${f.horizon} ${f.basis}`).toBeLessThanOrEqual(of.length);
      expect(f.baselinePosition.cases).toHaveLength(f.position.cases.length);
      expect(f.lapTime.cases).toHaveLength(f.position.cases.length);
      for (const c of f.position.cases) expect(of.some((o) => o.carId === c.carId && o.lap === c.lap), `h ${f.horizon} car ${c.carId} lap ${c.lap}`).toBe(true);
      for (const c of f.baselinePosition.cases) {
        const k = of.find((o) => o.carId === c.carId && o.lap === c.lap)!;
        expect(c).toMatchObject({ predicted: k.baselinePosition, actual: k.actualPosition, error: k.actualPosition - k.baselinePosition });
      }
      for (const c of f.lapTime.cases) expect(c.actual).toBe(of.find((o) => o.carId === c.carId && o.lap === c.lap)!.actualLapTimeMs);
    }
  });

  it("split AI and human by the car-driver span at the case's frame", () => {
    const report = reportOnce();
    for (const table of tablesOf(report)) {
      for (const c of table.cases) expect(c.driver, `${table.name} car ${c.carId} lap ${c.lap}`).toBe(HUMANS.has(c.carId) ? 'human' : 'ai');
      expect(table.ai.n, table.name).toBe(table.cases.filter((c) => c.driver === 'ai').length);
      expect(table.human.n, table.name).toBe(table.cases.filter((c) => c.driver === 'human').length);
      if (table.ai.n === 0) expect(table.ai.meanAbs.known).toBe(false);
    }
    expect(report.forecasts.some((f) => f.position.human.n > 0)).toBe(true);
  });

  it('a takeover: cases before it under human, after under AI', () => {
    // Car 7 (human) is handed to the AI on the frame it starts lap 10; it stops on lap 9.
    const params = { ...SMALL, field: SMALL.field.map((car, i) => (i === 7 ? { ...car, takeoverLap: 10 } : car)) };
    const taken = run(inputAt(generated(params)), createRng(0));
    const car7 = taken.forecasts.flatMap((f) => f.position.cases).filter((c) => c.carId === 7);
    expect(car7.filter((c) => c.lap <= 8).length).toBeGreaterThan(0);
    expect(car7.filter((c) => c.lap >= 10).length).toBeGreaterThan(0);
    for (const c of car7) {
      if (c.lap <= 8) expect(c.driver, `lap ${c.lap}`).toBe('human');
      if (c.lap >= 10) expect(c.driver, `lap ${c.lap}`).toBe('ai');
    }
    expect(taken.experiments.rejoin.cases.find((c) => c.carId === 7)?.driver).toBe('human');
  });

  it('no state between runs: a second run on the same input gives the same report (C31)', () => {
    run(inputAt(race, race.framesOfLap(12)[0]!), createRng(0));
    expect(run(inputOnce(), createRng(0))).toEqual(reportOnce());
  });
});
