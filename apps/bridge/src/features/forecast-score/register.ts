import { FORECAST_FIELD_CONFIG, FORECAST_SCORE_CONFIG, FORECAST_SCORE_JOB } from '@pitwall/analysis';
import { bindJob, defineFeature } from '../feature.ts';

/**
 * `forecast-score` (SP4.3a spec 7.1): the scoreboard, a job (C51) triggered at the leader's crossing and run in a
 * worker only while `forecastScore.report` is subscribed (C49); its result is published as `Computed<T>`.
 * It also declares `forecast-field`'s config (C47): `forecast-field` is no unit, and this is the unit that builds the
 * starting point, so `config.json` overrides it and the config sidecar keeps it.
 */
export default defineFeature({
  name: 'forecast-score',
  calculators: [],
  topics: [bindJob('forecastScore.report', FORECAST_SCORE_JOB)],
  jobs: [FORECAST_SCORE_JOB],
  config: [FORECAST_SCORE_CONFIG, FORECAST_FIELD_CONFIG],
});
