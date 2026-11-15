// The rain timeline of one scenario (SP4.3b spec §7.1, S12; Tasks 19b, 23b; SP4.3c O3b): the scenario's draws of the
// weather, handed to `weather-paths` (the one weather generator). One uniform `u` per scenario; an approximate forecast
// is read a drawn number of laps earlier or later. The draws are the session stream's, keyed (scenario, purpose), so
// every candidate sees the same weather (common random numbers, C2).
import type { StartingPoint } from '@pitwall/domain';
import { normal, streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { weatherPath, type WeatherLap } from '../weather-paths/index.ts';
import { APPROXIMATE_SHIFT_SD_LAPS, MC_PURPOSE } from './constants.ts';

export type { WeatherLap } from '../weather-paths/index.ts';

/**
 * The scenario's timeline, laps `start.lap` … `start.lapsTotal`; `null` without a forecast (the starting point's
 * wetness on every lap, no rain model, C3).
 */
export function drawWeather(start: StartingPoint, draws: Draws): WeatherLap[] | null {
  if (!start.weather.known) return null;
  const key = streamKey(draws, start.cars, 0);
  const shift = start.weather.value.accuracy === 'approximate' ? Math.round(APPROXIMATE_SHIFT_SD_LAPS * normal(key, MC_PURPOSE.forecastShift, 0)) : 0;
  return weatherPath(start, uniform(key, MC_PURPOSE.rain, 0), shift);
}

/** The timeline's wetness as a scenario carries it (`Scenario.wetnessByLap`, index 0 at `start.lap`). */
export const wetnessPath = (weather: readonly WeatherLap[]): Float64Array => Float64Array.from(weather, (w) => w.wetnessMs);
