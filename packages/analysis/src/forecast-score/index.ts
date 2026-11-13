// `forecast-score` (SP4.3a spec 7.1): an analysis with a job (C51) that rebuilds past starting points and scores the
// plain forecasts and the natural experiments against what happened, AI and human apart. Topic `forecastScore.report`.
import type { ForecastScoreReport } from '@pitwall/domain';
import type { Job } from '@pitwall/engine/readers';
import { prepareScore, type ScoreInput } from './job.ts';

export { FORECAST_SCORE_BEHAVIOUR, type ForecastScoreEffect } from './behaviour.ts';
export * from './config.ts';
export { naturalExperiments, orderAtPitExit, type Case, type CaseKind, type Experiments, type ForecastScoreConfig } from './experiments.ts';
export { forecastCases, forecastPolicies, type ForecastCase, type Horizon } from './forecasts.ts';
export { prepareScore, run as runForecastScore, type ScoreInput } from './job.ts';

/** The analysis id (its job's id). */
export const FORECAST_SCORE = 'forecast-score';

/** The output: the scoreboard. */
export type ForecastScoreOutput = ForecastScoreReport;

/** The job (C51): triggered at the leader's crossing (and on a rewind), on demand of `forecastScore.report` (C49). */
export const FORECAST_SCORE_JOB: Job<ScoreInput, ForecastScoreReport> = {
  kind: 'job',
  id: FORECAST_SCORE,
  // the brief's reads (`crossings` is the change tag `miniSectors`), the session's fixed values `prepare` takes
  // (`session`, `identity`), and the spans the forecast units read as of a frame (`car-status`, `compound-rule`)
  reads: [
    'laps', 'stints', 'pitStops', 'miniSectors', 'events', 'decisions', 'drivers', 'session', 'identity',
    'spans:car-driver', 'spans:session-phase-race', 'spans:weekend-phase', 'spans:car-status', 'spans:compound-rule',
  ],
  trigger: 'leaderLap',
  prepare: (view) => prepareScore(view),
  module: new URL('./job.ts', import.meta.url),
};
