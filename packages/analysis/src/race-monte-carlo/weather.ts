// The rain timeline of one scenario (SP4.3b spec §7.1, S12; Task 19b): per lap from `start.lap` to the flag whether it
// rains, drawn from the forecast's rain chance on that lap (read a drawn number of laps earlier or later when the
// forecast is approximate), and the wetness it leaves: rain raises it, a dry lap lowers it. The draws are the session
// stream's, keyed (scenario, lap, purpose), so every candidate sees the same weather (common random numbers, C2).
import type { StartingPoint } from '@pitwall/domain';
import { normal, streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { APPROXIMATE_SHIFT_SD_LAPS, MC_PURPOSE, WETNESS_FALL_MS_PER_LAP, WETNESS_MAX_MS, WETNESS_RISE_MS_PER_LAP } from './constants.ts';

/** One lap of the timeline: whether it rained, and the wetness the lap model reads on it. */
export type WeatherLap = { lap: number; rain: boolean; wetnessMs: number };

/** The forecast's rain chance (0–100) on lap `lap`: its entry for that lap, else the nearest entry's; 0 without any. */
function rainPctAt(byLap: readonly { lap: number; rainPct: number }[], lap: number): number {
  let best: { lap: number; rainPct: number } | undefined;
  for (const e of byLap) if (best === undefined || Math.abs(e.lap - lap) < Math.abs(best.lap - lap)) best = e;
  return best?.rainPct ?? 0;
}

/**
 * The scenario's timeline, laps `start.lap` … `start.lapsTotal`; `null` without a forecast (the starting point's
 * wetness on every lap, no rain model, C3).
 */
export function drawWeather(start: StartingPoint, draws: Draws): WeatherLap[] | null {
  if (!start.weather.known) return null;
  const { byLap, accuracy } = start.weather.value;
  const key = streamKey(draws, start.cars, 0);
  const shift = accuracy === 'approximate' ? Math.round(APPROXIMATE_SHIFT_SD_LAPS * normal(key, MC_PURPOSE.forecastShift, 0)) : 0;
  const out: WeatherLap[] = [];
  let w = start.wetness.wetnessMs;
  for (let lap = start.lap; lap <= start.lapsTotal; lap++) {
    const rain = uniform(key, MC_PURPOSE.rain, lap) * 100 < rainPctAt(byLap, lap + shift);
    w = rain ? Math.min(WETNESS_MAX_MS, w + WETNESS_RISE_MS_PER_LAP) : Math.max(0, w - WETNESS_FALL_MS_PER_LAP);
    out.push({ lap, rain, wetnessMs: w });
  }
  return out;
}

/** The timeline's wetness as a scenario carries it (`Scenario.wetnessByLap`, index 0 at `start.lap`). */
export const wetnessPath = (weather: readonly WeatherLap[]): Float64Array => Float64Array.from(weather, (w) => w.wetnessMs);
