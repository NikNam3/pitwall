// `forecast-score`'s job (C51; SP4.3a spec 7.1): `prepare` takes what the scoring needs from the view, structured-
// cloneable (the projection with its append frames, so `projectionAsOf` can cut it in the worker); `run` rebuilds the
// starting point at every case's frame (`startingPointAt`), runs the plain forecast (`raceForecast`) and scores it
// against what happened. No state between runs (C31).
import type { ForecastScoreReport } from '@pitwall/domain';
import type { AsOfView, EngineView, Projection, Rng, Situation } from '@pitwall/engine/readers';

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

/** The job's input from the view (`FORECAST_SCORE_JOB.prepare`): plain data only, no getters, no functions. */
export function prepareScore(_view: EngineView): ScoreInput {
  throw new Error('not implemented');
}

/**
 * The scoreboard over `input` (runs in a worker). The plain forecast draws nothing, so `rng` is unused in 4.3a and the
 * report is deterministic. Each table splits its cases AI and human by the car's `car-driver` span at the case's
 * predict frame (membership, C26); a case's `lap` is its predict lap (rejoin, undercut, SC stop: the stop lap; a
 * forecast: L).
 */
export function run(_input: ScoreInput, _rng: Rng): ForecastScoreReport {
  throw new Error('not implemented');
}
