// Value type of the `weather` analysis (spec 3.3): the game's forecast for this session with the first rain sample.
import type { Known } from '../known.ts';
import type { ForecastSample } from '../session.ts';

/** `weather.forecast`: the samples in time order; `firstRainIndex` from `rain-outlook` (C43), `notApplicable` if none. */
export type WeatherForecast = { samples: ForecastSample[]; accuracy: 'perfect' | 'approximate'; firstRainIndex: Known<number> };
