// `forecast-score`'s forecast tables (SP4.3b1 Task 11g; Q3 C fix 2, 2026-11-12; C26, C45): a forecast case of horizon
// h at leader lap L of a car is also left out when that car's own plain-forecast policy (rival-stops' window, our cars
// their actual stops, as the job forecasts with) holds a stop on a lap in L…L+h before the race's last lap: the
// baseline never predicts a stop, and stop timing is scored by the experiments. A predicted stop on the last lap, and
// another car's predicted stop, leave the case in. The natural experiments are unchanged, and after a flashback the
// report equals a run without the undone frames (C33).
import type { Policy, RivalStops } from '@pitwall/domain';
import { createRng, projectionAsOf, runAsOf, type AsOfView, type DeepReadonly } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { actualStops, naturalExperiments } from '../../src/forecast-score/experiments.ts';
import { forecastCases, forecastPolicies, type ForecastCase, type Horizon } from '../../src/forecast-score/forecasts.ts';
import { prepareScore, run, type ScoreInput } from '../../src/forecast-score/job.ts';
import { raceLaps } from '../../src/forecast-score/laps.ts';
import { RIVAL_STOPS } from '../../src/rival-stops/index.ts';
import { buildStartingPoint, FORECAST_UNITS } from '../../src/shared/forecast-field/index.ts';
import { CONFIG, generated, inputAt, SMALL, viewOf } from './support.ts';

const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];

/** The small generator race (player car 0, 20 laps), but car 3 (AI) never stops: rival-stops predicts its overdue stop. */
const NO_STOP_CAR = 3;
const PARAMS = { ...SMALL, field: SMALL.field.map((car, i) => (i === NO_STOP_CAR ? { ...car, stops: [] } : car)) };
const race = generated(PARAMS);
const LAST_LAP = PARAMS.laps;

/** Computed once, on first use (a throw fails the test that asked, not the file). */
const once = <T>(f: () => T): (() => T) => {
  let v: { value: T } | undefined;
  return () => (v ??= { value: f() }).value;
};
const inputOnce = once(() => inputAt(race));
const reportOnce = once(() => run(inputOnce(), createRng(0)));

/**
 * Per leader lap L of `input`'s forecast cases, every car's stop laps in the plain forecast's policies from the
 * leader's lap-L record: rival-stops' window as of that frame (`forecastPolicies`), our cars (the player's) on their
 * actual stops, as the job forecasts.
 */
function predictedStops(input: ScoreInput): Map<number, number[][]> {
  const { history, situation } = input;
  const race = raceLaps(history);
  const out = new Map<number, number[][]>();
  for (const c of forecastCases(history, HORIZONS)) {
    if (out.has(c.lap)) continue;
    const cut = projectionAsOf({ history, situation }, c.predictFrame);
    const asOf: AsOfView = { ...input, history: cut.history, situation: cut.situation, frame: c.predictFrame, at: c.predictAt, outputs: new Map() };
    const outputs = runAsOf(FORECAST_UNITS, asOf);
    const start = buildStartingPoint(asOf, outputs);
    if (!start.known) continue;
    const cars = start.value.cars;
    const policies: Policy[] = forecastPolicies((outputs.get(RIVAL_STOPS) as DeepReadonly<RivalStops> | undefined) ?? {}, cars);
    const player = input.fixed.playerCar.known ? input.fixed.playerCar.value : undefined;
    if (player !== undefined && player < cars) policies[player] = actualStops(history, race, c.predictFrame, cars)[player] as Policy;
    out.set(c.lap, policies.map((p) => p.stops.map((s) => s.lap)));
  }
  return out;
}
const predictedOnce = once(() => predictedStops(inputOnce()));

/** The stops of car `car`'s plain-forecast policy at leader lap `c.lap` that lie in L…L+h. */
const ownInHorizon = (c: ForecastCase, car: number = c.carId) =>
  (predictedOnce().get(c.lap)?.[car] ?? []).filter((lap) => c.lap <= lap && lap <= c.lap + c.horizon);

/** Whether the job leaves `c` out by Task 11g: a stop of its own policy in its horizon before the last lap. */
const leftOut = (c: ForecastCase) => ownInHorizon(c).some((lap) => lap < LAST_LAP);

const key = (car: number, lap: number, horizon: number, basis: string) => `${car}:${lap}:h${horizon}:${basis}`;
const caseKey = (c: ForecastCase) => key(c.carId, c.lap, c.horizon, c.basis);

/** The keys of every case of a table of `report`, per table kind. */
function scoredKeys(report: ReturnType<typeof run>): { position: string[]; lapTime: string[]; baselinePosition: string[] } {
  const of = (pick: (f: (typeof report.forecasts)[number]) => { cases: readonly { carId: number; lap: number }[] }) =>
    report.forecasts.flatMap((f) => pick(f).cases.map((c) => key(c.carId, c.lap, f.horizon, f.basis))).sort();
  return { position: of((f) => f.position), lapTime: of((f) => f.lapTime), baselinePosition: of((f) => f.baselinePosition) };
}

describe("forecast-score Task 11g: no stop of the car's own predicted policy in a forecast horizon", () => {
  it("a case whose horizon holds a stop of the car's own predicted policy is left out, the car did not stop", () => {
    const input = inputOnce();
    // Car 3 never stops: no pit stop of it in the projection, so Task 11e leaves none of its cases out.
    expect(input.history.pitStops.filter((s) => s.carId === NO_STOP_CAR)).toEqual([]);
    const cases = forecastCases(input.history, HORIZONS);
    const car3 = cases.filter((c) => c.carId === NO_STOP_CAR);
    const out = car3.filter(leftOut);
    // ...but rival-stops predicts its overdue stop before the last lap within some of its horizons.
    expect(out.length).toBeGreaterThan(0);
    const scored = scoredKeys(reportOnce());
    for (const c of out) {
      expect(scored.position, `car 3 lap ${c.lap} h${c.horizon}: own stop ${ownInHorizon(c).join('/')}`).not.toContain(caseKey(c));
      expect(scored.lapTime).not.toContain(caseKey(c));
      expect(scored.baselinePosition).not.toContain(caseKey(c));
    }
    // Its cases without an own predicted stop in the horizon still count.
    expect(car3.filter((c) => !leftOut(c)).length).toBeGreaterThan(0);
    for (const c of car3.filter((c) => !leftOut(c))) expect(scored.position).toContain(caseKey(c));

    // Over every car: the job scores exactly the forecast cases whose horizon holds no stop of the car's own policy
    // before the last lap, and Task 11g leaves some out.
    const expected = cases.filter((c) => !leftOut(c)).map(caseKey).sort();
    expect(expected.length).toBeLessThan(cases.length);
    expect(scored.position).toEqual(expected);
    expect(scored.lapTime).toEqual(expected);
    expect(scored.baselinePosition).toEqual(expected);
  });

  it('a predicted stop on the last lap does not leave the case out', () => {
    const cases = forecastCases(inputOnce().history, HORIZONS);
    // Cases whose horizon holds a stop of the car's own policy, every one of them on the race's last lap.
    const onLast = cases.filter((c) => {
      const own = ownInHorizon(c);
      return own.length > 0 && own.every((lap) => lap === LAST_LAP);
    });
    expect(onLast.length).toBeGreaterThan(0);
    expect(onLast.some((c) => c.carId === NO_STOP_CAR)).toBe(true);
    const scored = scoredKeys(reportOnce());
    for (const c of onLast) expect(scored.position, `car ${c.carId} lap ${c.lap} h${c.horizon}`).toContain(caseKey(c));
  });

  it("another car's predicted stop does not leave the case out", () => {
    const cases = forecastCases(inputOnce().history, HORIZONS);
    const cars = SMALL.cars;
    // Cases of cars without an own predicted stop in the horizon while car 3's policy holds one before the last lap.
    const others = cases.filter(
      (c) => c.carId !== NO_STOP_CAR && !leftOut(c) && ownInHorizon(c, NO_STOP_CAR).some((lap) => lap < LAST_LAP),
    );
    expect(others.length).toBeGreaterThan(0);
    expect(new Set(others.map((c) => c.carId)).size).toBeGreaterThan(1);
    expect(others.every((c) => c.carId < cars)).toBe(true);
    const scored = scoredKeys(reportOnce());
    for (const c of others) expect(scored.position, `car ${c.carId} lap ${c.lap} h${c.horizon}`).toContain(caseKey(c));
  });

  it('experiments are unchanged by Task 11g', () => {
    const input = inputOnce();
    const report = reportOnce();
    const { rejoin, undercut, scStop } = naturalExperiments(input.history, CONFIG, input.situation);
    // Seven green stops (car 3 never stops): every one is a rejoin case and is scored, actual as it happened.
    expect(rejoin).toHaveLength(SMALL.cars - 1);
    expect(report.experiments.rejoin.cases).toHaveLength(rejoin.length);
    for (const c of report.experiments.rejoin.cases) {
      expect(c.actual, `car ${c.carId}`).toBe(rejoin.find((k) => k.carId === c.carId)!.measure(input.history));
    }
    expect(report.experiments.undercut.cases.length).toBeLessThanOrEqual(undercut.length);
    expect(report.experiments.scStop.cases).toHaveLength(scStop.length);
    // The experiment tables equal those of the same race scored by the job before its forecast cases: a run whose
    // forecasts have no horizon gives the same experiments.
    const noForecasts = run({ ...input, config: { ...input.config, 'forecast-score': { ...CONFIG, horizons: '' } } } as ScoreInput, createRng(0));
    expect(noForecasts.forecasts).toEqual([]);
    expect(report.experiments).toEqual(noForecasts.experiments);
  });

  it('rewind: output equals a run without the undone frames (C33)', () => {
    // Car 3 never stops; a flashback from the leader's lap 16 to its lap 13.
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
