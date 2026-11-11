// The scoreboard (SP4.3a spec 7.1): the natural experiments and the plain forecasts scored against what happened, AI and human apart; a job's result (C51).
import type { ForecastScoreReport } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Computed<ForecastScoreReport>>({ owner: 'forecast-score', mode: 'state', maxHz: 1 });
