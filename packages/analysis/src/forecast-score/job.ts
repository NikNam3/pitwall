// `forecast-score`'s job (C51; SP4.3a spec 7.1): `prepare` takes what the scoring needs from the view, structured-
// cloneable (the projection with its append frames, so `projectionAsOf` can cut it in the worker); `run` rebuilds the
// starting point at every case's frame (`forecast-field`: the projection cut, the forecast units run as of it, the
// build, as `startingPointAt` does, keeping `rival-stops`' output for the forecast tables' policies), runs the plain
// forecast (`raceForecast`) and scores it against what happened. No state between runs (C31).
import { carDriverSpans } from '@pitwall/domain';
import type {
  CarId,
  ForecastScoreReport,
  ForecastTrace,
  FrameNumber,
  Known,
  MachineId,
  Policy,
  RivalStops,
  Scenario,
  ScoreCase,
  SessionTime,
  StartingPoint,
} from '@pitwall/domain';
import {
  asOfNow,
  projectionAsOf,
  situationAt,
  runAsOf,
  type AsOfView,
  type DeepReadonly,
  type EngineView,
  type Projection,
  type Rng,
  type Situation,
} from '@pitwall/engine/readers';
import { raceForecast } from '../race-forecast/index.ts';
import { fieldPositions } from '../race-monte-carlo/field.ts';
import type { FieldInput, RivalRules } from '../race-monte-carlo/types.ts';
import { RIVAL_STOPS } from '../rival-stops/index.ts';
import { buildStartingPoint, FORECAST_UNITS } from '../shared/forecast-field/index.ts';
import { leaderLapAt, neutralisationKind, neutralisedSpans, isClosed } from '../shared/neutralised.ts';
import { ourCars } from '../shared/our-cars.ts';
import { STRATEGY_CONFIG } from '../strategy/config.ts';
import { FORECAST_SCORE_CONFIG } from './config.ts';
import { crpsSummary, rankedProbabilityScore } from './crps.ts';
import { actualStops, naturalExperiments, type Case, type ForecastScoreConfig } from './experiments.ts';
import { forecastCases, forecastPolicies, HORIZONS, type ForecastCase, type Horizon } from './forecasts.ts';
import { raceLaps } from './laps.ts';
import { scored, scoreTable } from './tables.ts';

/**
 * The job's input: the projection (its `appendedAt` included) and the open spans now, the run's fixed inputs, and the
 * session's values an as-of view needs (`fixed`, with `setsNow` and `weatherNow` null: a past frame has none, R17).
 */
export type ScoreInput = {
  history: Projection;
  situation: Situation;
  config: EngineView['config'];
  priors: EngineView['priors'];
  drivers: EngineView['drivers'];
  track: EngineView['track'];
  weekend: EngineView['weekend'];
  fixed: AsOfView['fixed'];
};

/** The sub-machines whose spans the job reads (its declared `spans:<machine>` reads, C41). */
export const SCORE_MACHINES: readonly MachineId[] = ['car-driver', 'session-phase-race', 'weekend-phase', 'car-status', 'compound-rule'];

/** The fact lists the job reads (`miniSectors` is the change tag of `crossings`); the others stay empty. */
const SCORE_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'decisions'] as const;

/**
 * The job's input from the view (`FORECAST_SCORE_JOB.prepare`): plain data only, no getters, no functions. Each list is
 * a copy of the projection's (its entries are facts, never changed, C24), so the engine's later appends never reach
 * an input already prepared.
 */
export function prepareScore(view: EngineView): ScoreInput {
  const h = view.history as DeepReadonly<Projection>;
  const spans: Record<MachineId, unknown[]> = {};
  const open: Record<MachineId, unknown[]> = {};
  for (const m of SCORE_MACHINES) {
    const closed = h.spans[m];
    if (closed !== undefined) spans[m] = [...closed];
    const now = view.situation.byMachine[m];
    if (now !== undefined) open[m] = [...now];
  }
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const [list, frames] of Object.entries(h.appendedAt ?? {})) appendedAt[list] = [...(frames as readonly FrameNumber[])];
  const lists = Object.fromEntries(SCORE_LISTS.map((list) => [list, [...(h[list] as readonly unknown[])]]));
  const history = { ...lists, penalties: [], clock: [], spans, appendedAt } as unknown as Projection;
  const fixed = asOfNow(view).fixed;
  return {
    history,
    situation: { weekendPhase: view.situation.weekendPhase, byMachine: open } as Situation,
    config: view.config,
    priors: view.priors,
    drivers: view.drivers,
    track: view.track,
    weekend: view.weekend,
    fixed: { totalLaps: fixed.totalLaps, playerCar: fixed.playerCar, teammateCar: fixed.teammateCar, aiDifficulty: fixed.aiDifficulty, safetyCar: fixed.safetyCar, setsNow: null, weatherNow: null },
  };
}

/** The horizons of the config (`horizons`, comma-separated), those the report has a table for. */
function horizonsOf(config: ForecastScoreConfig): Horizon[] {
  const given = new Set(String(config.horizons).split(',').map((s) => Number(s.trim())));
  return HORIZONS.filter((h) => given.has(h));
}

/** A starting point as of a frame, with the `rival-stops` output it was built with. */
type Built = { start: Known<StartingPoint>; stops: DeepReadonly<RivalStops> };

/**
 * The scoreboard over `input` (runs in a worker). The plain forecast draws nothing, so `rng` is unused in 4.3a and the
 * report is deterministic. Each table splits its cases AI and human by the car's `car-driver` span at the case's
 * predict frame (membership, C26); a case's `lap` is its predict lap (rejoin, undercut, SC stop: the stop lap; a
 * forecast: L).
 */
export function run(input: ScoreInput, rng: Rng): ForecastScoreReport {
  const { history, situation } = input;
  const config = { ...FORECAST_SCORE_CONFIG.defaults, ...input.config[FORECAST_SCORE_CONFIG.key] } as ForecastScoreConfig;
  const race = raceLaps(history);
  let at: SessionTime = 0;
  for (const l of history.laps) at = Math.max(at, l.completedAt);

  const base: AsOfView = { ...input, frame: 'now', at, outputs: new Map() };
  // within this run only: the cases predicted on one frame share its build
  const builds = new Map<FrameNumber, Built>();
  const buildAt = (frame: FrameNumber, time: SessionTime): Built => {
    let b = builds.get(frame);
    if (b === undefined) {
      const cut = projectionAsOf({ history, situation }, frame);
      const asOf: AsOfView = { ...base, history: cut.history, situation: cut.situation, frame, at: time };
      const outputs = runAsOf(FORECAST_UNITS, asOf);
      b = { start: buildStartingPoint(asOf, outputs), stops: (outputs.get(RIVAL_STOPS) as DeepReadonly<RivalStops> | undefined) ?? {} };
      builds.set(frame, b);
    }
    return b;
  };
  // who drove each car at a frame: its car-driver span covering the frame (membership, C26), once per frame
  const source = { history, situation };
  const humansAt = new Map<FrameNumber, Set<CarId>>();
  const driverAt = (frame: FrameNumber, car: CarId): ScoreCase['driver'] => {
    let humans = humansAt.get(frame);
    if (humans === undefined) {
      humans = new Set();
      for (const span of situationAt(source, frame)[carDriverSpans.machine] ?? []) if (span.kind === 'human' && span.carId !== undefined) humans.add(span.carId);
      humansAt.set(frame, humans);
    }
    return humans.has(car) ? 'human' : 'ai';
  };

  // the actual SC and VSC periods (an experiment's scenario: it isolates the stop, every other event as it happened)
  const periods = neutralisedSpans(history, situation).filter((s) => s.kind === 'neutralised');
  const scenarioFrom = (frame: FrameNumber, lapsTotal: number): Scenario => ({
    id: 0,
    plain: true,
    neutralisations: periods
      .filter((s) => !isClosed(s) || s.endFrame > frame)
      .map((s) => ({
        kind: neutralisationKind(s) === 'VSC' ? ('vsc' as const) : ('sc' as const),
        fromLap: leaderLapAt(history.laps, s.startFrame),
        toLap: isClosed(s) ? leaderLapAt(history.laps, s.endFrame - 1) : lapsTotal,
      })),
  });
  const traceAt = (trace: ForecastTrace | undefined, lap: number) => trace?.find((e) => e.lap === lap);

  // the natural experiments: each its own forecast, every car on its actual stops (P7)
  const experiment = (c: Case): ScoreCase | undefined => {
    const { start } = buildAt(c.predictFrame, c.predictAt);
    if (!start.known) return undefined;
    const sp = start.value;
    const result = raceForecast(sp, c.policy, scenarioFrom(c.predictFrame, sp.lapsTotal), rng, { trace: true, toLap: c.targetLap });
    const entry = traceAt(result.trace, c.targetLap);
    const car = c.carId;
    if (entry === undefined || (entry.position[car] ?? 0) === 0) return undefined;
    let predicted: number;
    if (c.otherCarId === undefined) predicted = entry.position[car] as number;
    else {
      const o = c.otherCarId;
      if ((entry.position[o] ?? 0) === 0) return undefined;
      const startGap = (sp.gapMs[o] ?? 0) - (sp.gapMs[car] ?? 0);
      predicted = Math.round((entry.gapMs[o] as number) - (entry.gapMs[car] as number) - startGap);
    }
    return scored({ carId: car, driver: driverAt(c.predictFrame, car), lap: c.lap, predicted, actual: c.measure(history) });
  };
  const experiments = naturalExperiments(history, config, situation);
  const scoreAll = (cases: readonly Case[]) => cases.flatMap((c) => experiment(c) ?? []);

  // the plain forecasts: one forecast per leader lap, rivals on rival-stops' windows, our cars on their actual stops
  const horizons = horizonsOf(config);
  const byLap = new Map<number, ForecastCase[]>();
  for (const c of forecastCases(history, horizons, config.minPredictLap)) {
    const of = byLap.get(c.lap);
    if (of === undefined) byLap.set(c.lap, [c]);
    else of.push(c);
  }
  type Scored = { c: ForecastCase; lapTime: ScoreCase; position: ScoreCase; baseline: ScoreCase };
  const forecasts: Scored[] = [];
  const fixed = input.fixed;
  const ours = fixed.playerCar.known ? ourCars({ playerCar: fixed.playerCar.value, teammateCar: fixed.teammateCar.known ? fixed.teammateCar.value : undefined }) : [];
  for (const [lap, cases] of byLap) {
    const first = cases[0] as ForecastCase;
    const { start, stops } = buildAt(first.predictFrame, first.predictAt);
    if (!start.known) continue;
    const sp = start.value;
    const policies: Policy[] = forecastPolicies(stops, sp.cars);
    if (ours.length > 0) {
      const actual = actualStops(history, race, first.predictFrame, sp.cars);
      for (const car of ours) if (car < sp.cars) policies[car] = actual[car] as Policy;
    }
    const toLap = lap + Math.max(...cases.map((c) => c.horizon));
    const result = raceForecast(sp, policies, { id: 0, plain: true, neutralisations: [] }, rng, { trace: true, toLap });
    for (const c of cases) {
      // no stop of the car's own forecast policy in L…L+h before the race's last lap (SP4.3b Task 11g): the baseline
      // never predicts a stop, and stop timing is scored by the experiments
      const own = policies[c.carId]?.stops ?? [];
      if (own.some((s) => lap <= s.lap && s.lap <= lap + c.horizon && s.lap < sp.lapsTotal)) continue;
      const entry = traceAt(result.trace, c.targetLap);
      const position = entry?.position[c.carId] ?? 0;
      if (entry === undefined || position === 0) continue;
      const common = { carId: c.carId, driver: driverAt(c.predictFrame, c.carId), lap };
      forecasts.push({
        c,
        lapTime: scored({ ...common, predicted: entry.lapTimeMs[c.carId] as number, actual: c.actualLapTimeMs }),
        position: scored({ ...common, predicted: position, actual: c.actualPosition }),
        baseline: scored({ ...common, predicted: c.baselinePosition, actual: c.actualPosition }),
      });
    }
  }

  // the CRPS (SP4.3b spec §8.4): one `fieldPositions` run per predict lap (every `crpsEveryLaps` from `crpsFirstLap`)
  // over the plain plans, at the laps predict lap + each horizon, with a zero hazard (a scored case holds no SC or VSC
  // lap, F1), the rivals' rule from `strategy`'s config; each case scores its car's pmf at its target lap
  const strategy = STRATEGY_CONFIG.read(input);
  const rivalRules: RivalRules = { q: strategy.rivalScBoxChance, aMin: strategy.rivalScMinTyreAge, reactionLaps: strategy.rivalReactionLaps, coverRule: false };
  const crpsByLap = new Map<number, ForecastCase[]>();
  for (const c of forecastCases(history, horizons, config.crpsFirstLap)) {
    if ((c.lap - config.crpsFirstLap) % config.crpsEveryLaps !== 0) continue;
    const of = crpsByLap.get(c.lap);
    if (of === undefined) crpsByLap.set(c.lap, [c]);
    else of.push(c);
  }
  const crpsScores: { c: ForecastCase; driver: ScoreCase['driver']; score: number }[] = [];
  for (const [lap, cases] of crpsByLap) {
    const first = cases[0] as ForecastCase;
    const { start, stops } = buildAt(first.predictFrame, first.predictAt);
    if (!start.known) continue;
    const sp = start.value;
    const policies: Policy[] = forecastPolicies(stops, sp.cars);
    if (ours.length > 0) {
      const actual = actualStops(history, race, first.predictFrame, sp.cars);
      for (const car of ours) if (car < sp.cars) policies[car] = actual[car] as Policy;
    }
    const plans: FieldInput['plans'] = {};
    policies.forEach((p, car) => (plans[car as CarId] = p));
    const n = Math.max(0, sp.lapsTotal - sp.lap + 1);
    const hazard: FieldInput['hazard'] = { byLap: new Float64Array(n), vscByLap: new Float64Array(n), scDur: Float64Array.of(1), vscDur: Float64Array.of(1), active: null };
    const laps = horizons.map((h) => lap + h).filter((l) => l <= sp.lapsTotal);
    const result = fieldPositions({ start: sp, plans, hazard, rivalRules, scenarios: config.crpsScenarios, laps }, rng);
    for (const c of cases) {
      const pmf = result.positionPmf[c.carId]?.[laps.indexOf(c.targetLap)];
      if (pmf === undefined) continue;
      crpsScores.push({ c, driver: driverAt(c.predictFrame, c.carId), score: rankedProbabilityScore(pmf, c.actualPosition) });
    }
  }
  const crpsOf = (horizon: Horizon, basis: ForecastCase['basis'], driver: ScoreCase['driver']) =>
    crpsSummary(crpsScores.filter((s) => s.c.horizon === horizon && s.c.basis === basis && s.driver === driver).map((s) => s.score), at);

  return {
    experiments: {
      rejoin: scoreTable('rejoin', 'places', scoreAll(experiments.rejoin), at),
      undercut: scoreTable('undercut', 'ms', scoreAll(experiments.undercut), at),
      scStop: scoreTable('scStop', 'ms', scoreAll(experiments.scStop), at),
    },
    forecasts: horizons.flatMap((horizon) =>
      (['wear', 'age'] as const).map((basis) => {
        const of = forecasts.filter((f) => f.c.horizon === horizon && f.c.basis === basis);
        const name = `h${horizon}.${basis}`;
        return {
          horizon,
          basis,
          lapTime: scoreTable(`${name}.lapTime`, 'ms', of.map((f) => f.lapTime), at),
          position: scoreTable(`${name}.position`, 'places', of.map((f) => f.position), at),
          baselinePosition: scoreTable(`${name}.baselinePosition`, 'places', of.map((f) => f.baseline), at),
          crps: { ai: crpsOf(horizon, basis, 'ai'), human: crpsOf(horizon, basis, 'human') },
        };
      }),
    ),
  };
}
