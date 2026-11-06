// `weather` (spec 3.3): publishes `weather.forecast`, the game's forecast with the first rain sample from `rain-outlook`.
import type { WeatherForecast } from '@pitwall/domain';

export type { WeatherForecast } from '@pitwall/domain';

/** The analysis id. */
export const WEATHER = 'weather';

/** The output: the topic's value. */
export type WeatherOutput = WeatherForecast;
