// `forecast-score`'s forecast tables (SP4.3b1 Task 11e; U9 Q1 A, 2026-11-12; C26, C45, C47): a forecast case of
// horizon h at leader lap L of a car is left out when (a) any of laps L+1…L+h of that car is its own in-lap or out-lap
// (from the projection's pit stops and stints: a rival's real stop is not in its predicted policy, and stop timing is
// scored by the experiments), or (b) L < `minPredictLap` (default 3: no fitted pace before two pace laps; the standing
// start). The natural experiments are unchanged, and after a flashback the report equals a run without the undone
// frames (C33).
import { createRng, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { naturalExperiments } from '../../src/forecast-score/experiments.ts';
import { forecastCases, type ForecastCase, type Horizon } from '../../src/forecast-score/forecasts.ts';
import { prepareScore, run, type ScoreInput } from '../../src/forecast-score/job.ts';
import { CONFIG, generated, inputAt, plannedRace, SMALL, spacedField, viewOf } from './support.ts';

const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];

/** Four cars 1 s apart over 20 green laps, car 0 stopping on lap 12 (in-lap 12, out-lap 13). */
const stopRace = () => plannedRace({ laps: 20, cars: spacedField(4, 1_000, { 0: { stops: [{ lap: 12 }] } }) });

/** Whether a case's horizon (its car's laps L+1 … L+h) holds lap `n`. */
const holds = (c: ForecastCase, n: number) => c.lap + 1 <= n && n <= c.lap + c.horizon;

const key = (c: ForecastCase) => `${c.carId}:${c.lap}:${c.horizon}`;
const lapsOf = (cases: readonly ForecastCase[], car: number, horizon: Horizon) =>
  cases.filter((c) => c.carId === car && c.horizon === horizon).map((c) => c.lap).sort((a, b) => a - b);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** `input` with `forecast-score`'s config overridden by `over`. */
const withConfig = (input: ScoreInput, over: Partial<typeof CONFIG>): ScoreInput =>
  ({ ...input, config: { ...input.config, 'forecast-score': { ...CONFIG, ...over } } }) as ScoreInput;

/** The pit-stop laps (in-laps) and out-laps of every car of `history`, as `car:lap`. */
function ownStopLaps(history: Projection): Set<string> {
  const laps = new Set<string>();
  for (const s of history.pitStops) {
    laps.add(`${s.carId}:${s.lap}`);
    laps.add(`${s.carId}:${s.lap + 1}`);
  }
  return laps;
}

describe('forecast-score Task 11e: no own in-lap or out-lap in a forecast horizon, no case before minPredictLap', () => {
  it('a case whose horizon holds the car\'s own in-lap is left out; the same case of another car counts', () => {
    const race = stopRace();
    const cases = forecastCases(race.history, HORIZONS);
    // Car 0's in-lap is lap 12: no case of car 0 whose horizon holds it.
    expect(cases.filter((c) => c.carId === 0 && holds(c, 12))).toEqual([]);
    // Car 1 never stops: every case from lap 3 counts, those holding lap 12 included.
    for (const h of HORIZONS) expect(lapsOf(cases, 1, h), `car 1 h${h}`).toEqual(range(3, 20 - h));
    expect(cases.filter((c) => c.carId === 1 && holds(c, 12)).length).toBeGreaterThan(0);
    // Car 0 h1: every lap from 3 but 11 (its horizon the in-lap) and 12 (its horizon the out-lap).
    expect(lapsOf(cases, 0, 1)).toEqual([...range(3, 10), ...range(13, 19)]);
    // h3: laps 9–12 hold lap 12 or 13; h10: from lap 3 every horizon up to lap 10 holds lap 12 or 13 (laps 3–10 all hold 12).
    expect(lapsOf(cases, 0, 3)).toEqual([...range(3, 8), ...range(13, 17)]);
    expect(lapsOf(cases, 0, 10)).toEqual([]);

    // The job's tables on a generator race (every car one stop on laps 8 to 10): no scored forecast case's horizon holds
    // its car's own in-lap or out-lap, and the race has forecast cases.
    const input = inputAt(generated());
    const own = ownStopLaps(input.history);
    expect(own.size).toBeGreaterThan(0);
    const report = run(input, createRng(0));
    let scoredCases = 0;
    for (const f of report.forecasts) {
      for (const c of [...f.position.cases, ...f.lapTime.cases, ...f.baselinePosition.cases]) {
        scoredCases += 1;
        for (let n = c.lap + 1; n <= c.lap + f.horizon; n++) expect(own.has(`${c.carId}:${n}`), `h${f.horizon} car ${c.carId} lap ${c.lap}: lap ${n}`).toBe(false);
      }
    }
    expect(scoredCases).toBeGreaterThan(0);
  });

  it("a case whose horizon holds the car's own out-lap is left out", () => {
    const race = stopRace();
    const cases = forecastCases(race.history, HORIZONS);
    // From lap 12 (the in-lap as the start lap L, no horizon lap) every horizon starts with the out-lap 13: left out.
    expect(cases.filter((c) => c.carId === 0 && c.lap === 12)).toEqual([]);
    expect(cases.filter((c) => c.carId === 0 && holds(c, 13))).toEqual([]);
    // The out-lap as the start lap L is no horizon lap: car 0's cases from lap 13 count.
    expect(cases.filter((c) => c.carId === 0 && c.lap === 13).map((c) => c.horizon)).toEqual([1, 3, 5]);
    // The in-lap and the out-lap come from the projection's pit stops and stints, not the lap records' flags: without
    // the flags the same cases are left out.
    const unflagged = { ...race.history, laps: race.history.laps.map((l) => ({ ...l, inLap: false, outLap: false })) } as Projection;
    expect(forecastCases(unflagged, HORIZONS).map(key).sort()).toEqual(cases.map(key).sort());
  });

  it('no case is predicted from leader lap 1 or 2 (minPredictLap 3); from lap 3 they count', () => {
    expect(CONFIG.minPredictLap).toBe(3);
    // Three cars 1 s apart, 20 green laps, no stop.
    const race = plannedRace({ laps: 20, cars: spacedField(3, 1_000) });
    const cases = forecastCases(race.history, HORIZONS);
    expect(cases.filter((c) => c.lap < 3)).toEqual([]);
    for (const h of HORIZONS) {
      for (const car of [0, 1, 2]) expect(lapsOf(cases, car, h), `car ${car} h${h}`).toEqual(range(3, 20 - h));
    }
    // The threshold is the given one: from 1 every leader lap counts, from 5 none before lap 5.
    expect(forecastCases(race.history, HORIZONS, 1).filter((c) => c.lap < 3).map((c) => c.lap)).toContain(1);
    expect(Math.min(...forecastCases(race.history, HORIZONS, 5).map((c) => c.lap))).toBe(5);

    // The job reads it from its config (C47): the default scores from lap 3, an override of 5 from lap 5.
    const input = inputAt(generated());
    const lapsScored = (r: ReturnType<typeof run>) => r.forecasts.flatMap((f) => f.position.cases.map((c) => c.lap));
    expect(Math.min(...lapsScored(run(input, createRng(0))))).toBe(3);
    expect(Math.min(...lapsScored(run(withConfig(input, { minPredictLap: 5 }), createRng(0))))).toBe(5);
  });

  it('experiments are unchanged by Task 11e', () => {
    // The stop race: car 0's green stop on lap 12 still gives its rejoin case, predicted at its lap-11 record.
    const race = stopRace();
    const { rejoin } = naturalExperiments(race.history, CONFIG);
    expect(rejoin.map((c) => c.carId)).toEqual([0]);
    expect(rejoin[0]).toMatchObject({ predictFrame: race.lapOf(0, 11).frame });

    // The job's experiment tables do not depend on minPredictLap, and every car's stop still gives a rejoin case.
    const input = inputAt(generated());
    const from1 = run(withConfig(input, { minPredictLap: 1 }), createRng(0));
    const from10 = run(withConfig(input, { minPredictLap: 10 }), createRng(0));
    expect(from10.experiments).toEqual(from1.experiments);
    expect(from1.experiments.rejoin.cases).toHaveLength(SMALL.cars);
    // ...while the forecast tables do.
    const count = (r: typeof from1) => r.forecasts.reduce((n, f) => n + f.position.cases.length, 0);
    expect(count(from10)).toBeLessThan(count(from1));
  });

  it('rewind: output equals a run without the undone frames (C33)', () => {
    // Every car one stop on laps 8 to 10; a flashback from the leader's lap 16 to its lap 13.
    const race = generated();
    const target = race.framesOfLap(13)[0]!;
    const undone = race.framesOfLap(16)[0]!;
    const rewound = { ...viewOf(race, target), delta: race.viewAt(target, { from: undone }).delta };
    expect(rewound.delta.rewound).toBeDefined();
    const never = run(inputAt(race, target), createRng(0));
    expect(run(structuredClone(prepareScore(rewound)), createRng(0))).toEqual(never);
    const count = (r: typeof never) => r.forecasts.reduce((n, f) => n + f.position.cases.length, 0);
    expect(count(never)).toBeGreaterThan(0);
    expect(count(run(inputAt(race, undone), createRng(0)))).toBeGreaterThan(count(never));
  });
});
