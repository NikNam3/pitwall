// Value type of the `forecast-score` analysis (SP4.3a spec 7.1): the natural experiments and the plain forecasts scored against what happened, AI and human apart.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';

/** One scored case: the car, who drove it at the case's frame, the lap, and predicted against actual. */
export type ScoreCase = { carId: CarId; driver: 'ai' | 'human'; lap: number; predicted: number; actual: number; error: number };

/** One table: per driver type the number of cases, the mean absolute error and the bias, and every case. */
export type ScoreTable = {
  name: string;
  unit: 'ms' | 'places';
  ai: { n: number; meanAbs: Known<number>; bias: Known<number> };
  human: { n: number; meanAbs: Known<number>; bias: Known<number> };
  cases: ScoreCase[];
};

/** `forecastScore.report`: the three experiments, and per horizon and basis the forecast's errors beside the baseline. */
export type ForecastScoreReport = {
  experiments: { rejoin: ScoreTable; undercut: ScoreTable; scStop: ScoreTable };
  forecasts: { horizon: 1 | 3 | 5 | 10; basis: 'wear' | 'age'; lapTime: ScoreTable; position: ScoreTable; baselinePosition: ScoreTable }[];
};
