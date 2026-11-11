// `forecast-score` (SP4.3a spec 7.1): an analysis with a job (C51) that rebuilds past starting points and scores the
// plain forecasts and the natural experiments against what happened, AI and human apart. Topic `forecastScore.report`.
import type { ForecastScoreReport } from '@pitwall/domain';

export * from './config.ts';

/** The analysis id (its job's id). */
export const FORECAST_SCORE = 'forecast-score';

/** The output: the scoreboard. */
export type ForecastScoreOutput = ForecastScoreReport;
