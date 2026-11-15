// The golden cases of `weather-paths` (SP4.3c Task 14, O3b, spec §5.4a): starting points with a forecast and the
// uniform draws u (and an approximate forecast's shift) the Monte Carlo drew per scenario before the move, each with the
// path today's `race-monte-carlo/weather.ts` `drawWeather` gave (`golden.json`, generated from it before the move).
//
// How the test reads the simulator (the test agent's decisions, Task 14 report):
// - `weatherPath(start, u, shiftLaps?)`: u in [0, 1) (the scenario's uniform draw; it rains on lap L when `u · 100` is
//   below the forecast's chance on lap `L + shiftLaps`, the nearest entry's); `shiftLaps` the approximate forecast's
//   drawn timing error in whole laps (default 0, a perfect forecast's). The plan's interface names only `(start, u)`;
//   the shift is a draw of its own today (purpose `forecastShift`), so the Monte Carlo keeps drawing it and hands it over.
// - The draws below are the Monte Carlo's: scenario `id` of a run with base seed `base`, purposes `rain` 8 and
//   `forecastShift` 9 of the head stream (`streamKey(draws, start.cars, 0)`), the shift `round(2 · normal)` (today's
//   `APPROXIMATE_SHIFT_SD_LAPS` 2), each written here so the test does not depend on where the constants move.
import { known, type StartingPoint } from '@pitwall/domain';
import { drawsInto, normal, streamKey, uniform } from '../../src/race-forecast/draws.ts';
import { startingPoint } from '../race-forecast/start.ts';

/** The draws a golden case takes per scenario. */
export const DRAWS_PER_CASE = 10_000;

/** Today's draw purposes and shift sd (`race-monte-carlo/constants.ts` before the move). */
const RAIN_PURPOSE = 8;
const SHIFT_PURPOSE = 9;
const SHIFT_SD_LAPS = 2;

/** A forecast for laps `from` … `to` (every `step`-th lap), per lap the rain chance `pct(lap)`. */
function forecast(from: number, to: number, pct: (lap: number) => number, accuracy: 'perfect' | 'approximate', step = 1): StartingPoint['weather'] {
  const byLap: { lap: number; rainPct: number }[] = [];
  for (let lap = from; lap <= to; lap += step) byLap.push({ lap, rainPct: pct(lap) });
  return known({ byLap, accuracy }, 0);
}

/** A three-car field from lap `lap` to `lapsTotal` with the given wetness and forecast. */
function start(lap: number, lapsTotal: number, wetnessMs: number, sdMs: number, weather: StartingPoint['weather']): StartingPoint {
  const s = startingPoint({ lap, lapsTotal, cars: [{}, {}, {}], ours: [1] });
  s.wetness = { wetnessMs, sdMs };
  s.weather = weather;
  return s;
}

export type GoldenCase = { name: string; base: number; start: () => StartingPoint };

/** The cases: dry and wet starts, rising and falling chances, sparse forecasts read at the nearest entry, both accuracies. */
export const CASES: readonly GoldenCase[] = [
  { name: 'perfect, dry start, rain building from lap 8', base: 101, start: () => start(5, 30, 0, 300, forecast(1, 30, (l) => (l < 8 ? 0 : Math.min(90, 10 * (l - 7))), 'perfect')) },
  { name: 'perfect, wet start, drying chance', base: 202, start: () => start(12, 40, 11_000, 900, forecast(10, 40, (l) => Math.max(0, 70 - 5 * (l - 10)), 'perfect')) },
  { name: 'perfect, sparse forecast (every 5th lap), read at the nearest entry', base: 303, start: () => start(1, 25, 2_000, 500, forecast(3, 23, (l) => (l * 7) % 60, 'perfect', 5)) },
  { name: 'approximate, dry start, a shower mid-race', base: 404, start: () => start(3, 28, 0, 300, forecast(1, 28, (l) => (l >= 10 && l <= 16 ? 60 : 5), 'approximate')) },
  { name: 'approximate, at the ceiling under certain rain', base: 505, start: () => start(20, 35, 15_000, 1_200, forecast(18, 35, (l) => (l <= 27 ? 100 : 20), 'approximate')) },
  { name: 'perfect, no rain chance, a wet track drying', base: 606, start: () => start(6, 20, 9_000, 700, forecast(1, 20, () => 0, 'perfect')) },
];

/** Scenario `id`'s draws of case `c` as the Monte Carlo drew them before the move: u in [0, 1) and the shift in laps. */
export function drawOf(c: GoldenCase, s: StartingPoint, id: number): { u: number; shiftLaps: number } {
  const draws = drawsInto(c.base, id, new Int32Array(s.cars));
  const key = streamKey(draws, s.cars, 0);
  const shiftLaps = s.weather.known && s.weather.value.accuracy === 'approximate' ? Math.round(SHIFT_SD_LAPS * normal(key, SHIFT_PURPOSE, 0)) : 0;
  return { u: uniform(key, RAIN_PURPOSE, 0), shiftLaps };
}

/** A path as the golden file keeps it: per lap `lap:rain(0/1):wetnessMs`, joined. */
export const pathText = (path: readonly { lap: number; rain: boolean; wetnessMs: number }[] | null): string =>
  path === null ? 'null' : path.map((w) => `${w.lap}:${w.rain ? 1 : 0}:${w.wetnessMs}`).join(',');
