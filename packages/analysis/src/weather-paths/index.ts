// `weather-paths` (SP4.3c spec §5.4a, O3b): a simulator (C50), the one weather generator every planner uses: from the
// starting point's wetness and forecast, per lap whether it rains and the wetness it leaves (rain raises it, a dry lap
// lowers it). One uniform `u` per world: it rains on lap L when `u` is below the forecast's chance on L, so a world sees
// rain with the forecast's highest chance, not one less the product of the dry chances (SP4.3b Task 23b). No reads, no
// cadence, no topic; no randomness of its own (the caller hands it `u`, C2).
import type { StartingPoint } from '@pitwall/domain';
import { defineSimulator } from '@pitwall/engine/readers';
import { WETNESS_FALL_MS_PER_LAP, WETNESS_MAX_MS, WETNESS_RISE_MS_PER_LAP } from './constants.ts';

export * from './constants.ts';

export const SIMULATOR = defineSimulator('weather-paths');

/** One lap of a path: whether it rained, and the wetness the lap model reads on it. */
export type WeatherLap = { lap: number; rain: boolean; wetnessMs: number };

/** One world of the forecast: its `u`, its weight (the worlds' weights sum to 1) and its wetness per lap from `start.lap`. */
export type WeatherWorld = { u: number; weight: number; path: Float64Array };

/** The forecast's rain chance (0–100) on lap `lap`: its entry for that lap, else the nearest entry's; 0 without any. */
function rainPctAt(byLap: readonly { lap: number; rainPct: number }[], lap: number): number {
  let best: { lap: number; rainPct: number } | undefined;
  for (const e of byLap) if (best === undefined || Math.abs(e.lap - lap) < Math.abs(best.lap - lap)) best = e;
  return best?.rainPct ?? 0;
}

/**
 * The path of `u` (in [0, 1)), laps `start.lap` … `start.lapsTotal`: the forecast read `shiftLaps` laps later (an
 * approximate forecast's timing error, drawn by the caller; 0 for a perfect one). `null` without a forecast (the
 * starting point's wetness on every lap, no rain model, C3).
 */
export function weatherPath(start: StartingPoint, u: number, shiftLaps = 0): WeatherLap[] | null {
  if (!start.weather.known) return null;
  const { byLap } = start.weather.value;
  const pct = u * 100;
  const out: WeatherLap[] = [];
  let w = start.wetness.wetnessMs;
  for (let lap = start.lap; lap <= start.lapsTotal; lap++) {
    const rain = pct < rainPctAt(byLap, lap + shiftLaps);
    w = rain ? Math.min(WETNESS_MAX_MS, w + WETNESS_RISE_MS_PER_LAP) : Math.max(0, w - WETNESS_FALL_MS_PER_LAP);
    out.push({ lap, rain, wetnessMs: w });
  }
  return out;
}

/** A path's wetness per lap (index 0 at `start.lap`); without a forecast the starting point's wetness on every lap. */
function wetnessOf(start: StartingPoint, path: readonly WeatherLap[] | null): Float64Array {
  if (path !== null) return Float64Array.from(path, (w) => w.wetnessMs);
  return new Float64Array(Math.max(0, start.lapsTotal - start.lap + 1)).fill(start.wetness.wetnessMs);
}

const samePath = (a: Float64Array, b: Float64Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The forecast's `k` worlds for a planner: `u` at the `k` midpoint quantiles (`(i + 0.5) / k`), weight `1 / k` each, each
 * its `weatherPath` (no shift: the expected reading). One world of weight 1 when every path is equal (no rain chance
 * between the quantiles, or no forecast).
 */
export function weatherWorlds(start: StartingPoint, k: number): WeatherWorld[] {
  const worlds: WeatherWorld[] = [];
  for (let i = 0; i < k; i++) {
    const u = (i + 0.5) / k;
    worlds.push({ u, weight: 1 / k, path: wetnessOf(start, weatherPath(start, u)) });
  }
  const first = worlds[0];
  if (first !== undefined && worlds.every((w) => samePath(w.path, first.path))) return [{ ...first, weight: 1 }];
  return worlds;
}
