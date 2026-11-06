// Builders and cases shared by the forecast-strip gallery and its tests (test-phase file: the implementer does not edit
// it). Tests import the cases from here, never `gallery.ts` (C69). The samples are the approved mockup's
// (docs/design/2026-10-30-sp4a-displays/5-weather.html): rain coming (approximate, the first rain +30 at 45 %), dry
// (clear, 0 %, track 41°, air 26°, no first rain).
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { ForecastSample, Known, Trend, Weather, WeatherForecast } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_800_000);

/** A known first-rain index. */
export const rainAt = (index: number): Known<number> => known(index, at);
/** No sample brings rain (as `weather` gives it, from `rain-outlook`). */
export const noRain: Known<number> = unknown('notApplicable');

/** One sample; temperatures flat unless given. */
export const sample = (
  offsetMin: number, weather: Weather, rainPct: number, trackTempC: number, airTempC: number,
  trackTempTrend: Trend = 'flat', airTempTrend: Trend = 'flat',
): ForecastSample => ({ offsetMin, weather, rainPct, trackTempC, trackTempTrend, airTempC, airTempTrend });

export const forecast = (samples: ForecastSample[], firstRainIndex: Known<number> = noRain, accuracy: WeatherForecast['accuracy'] = 'perfect'): WeatherForecast =>
  ({ samples, accuracy, firstRainIndex });

/** The mockup's full strip: now to +60, cloud to heavy rain, the track cooling; the first rain is index 4 (+30, 45 %). */
export const rainSamples: ForecastSample[] = [
  sample(0, 'lightCloud', 5, 34, 21),
  sample(5, 'overcast', 10, 33, 21, 'down'),
  sample(10, 'overcast', 20, 32, 20, 'down', 'down'),
  sample(15, 'overcast', 30, 31, 20, 'down'),
  sample(30, 'lightRain', 45, 28, 19, 'down', 'down'),
  sample(45, 'lightRain', 60, 26, 18, 'down', 'down'),
  sample(60, 'heavyRain', 75, 24, 18, 'down'),
];

/** The mockup's dry case: clear now at 0 %, track 41°, air 26°; the track warming a little, no rain. */
export const drySamples: ForecastSample[] = [
  sample(0, 'clear', 0, 41, 26),
  sample(5, 'clear', 0, 42, 26, 'up'),
  sample(10, 'clear', 0, 42, 26),
  sample(15, 'lightCloud', 5, 43, 27, 'up', 'up'),
  sample(30, 'lightCloud', 5, 43, 27),
  sample(45, 'clear', 0, 42, 26, 'down', 'down'),
  sample(60, 'clear', 0, 41, 26, 'down'),
];

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup's full strip (first case: the screenshot baseline, Task 14): approximate, the first rain +30 at 45 %
  // white bold; compact `now cloud 5%  track 34° air 21°` / `rain 45% at +30 min`.
  rainComing: { forecast: forecast(rainSamples, rainAt(4), 'approximate') },
  // The mockup's dry case: perfect accuracy (no note), no sample brings rain: the first rain empty, not applicable.
  dry: { forecast: forecast(drySamples) },
  // No forecast sample for this session yet: no column, the first rain empty with its reason.
  noSamples: { forecast: forecast([]) },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (full: seven columns of seven plus the label column), the compact edge
 *  just below full, and a larger full. */
export const fit = [
  { mode: 'compact', cols: 34, rows: 2 },
  { mode: 'compact', cols: 55, rows: 5 },
  { mode: 'full', cols: 56, rows: 6 },
  { mode: 'full', cols: 72, rows: 8 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
