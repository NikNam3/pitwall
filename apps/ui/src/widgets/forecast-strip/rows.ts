// The forecast strip's rows (spec 4; C65): the topic's samples formatted, nothing computed. Which sample is the first
// rain is the topic's `firstRainIndex` (C43); the widget holds no threshold.
import type { ForecastSample, WeatherForecast } from '@pitwall/domain';
import { unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatMinutesAhead, formatPct, formatTemp, formatWhole } from '../../kit/values/format.ts';
import * as text from './text.ts';

/** One sample's column of the full strip. */
export type SampleColumn = {
  offset: string;
  sky: string;
  rain: string;
  track: string;
  trackTrend: string;
  air: string;
  airTrend: string;
  firstRain: boolean;
};

/** The minutes from now: `now` for the present sample, else `+5`. */
const offset = (min: number): string => (min === 0 ? text.now : formatMinutesAhead(min));

/** One column per sample in the topic's order; with `maxColumns`, the earliest that fit. */
export function fullColumns(forecast: WeatherForecast, maxColumns?: number): SampleColumn[] {
  const first = forecast.firstRainIndex;
  const samples = maxColumns === undefined ? forecast.samples : forecast.samples.slice(0, Math.max(0, maxColumns));
  return samples.map((s, i) => ({
    offset: offset(s.offsetMin),
    sky: text.weather[s.weather],
    rain: formatWhole(s.rainPct),
    track: formatTemp(s.trackTempC),
    trackTrend: text.trend[s.trackTempTrend],
    air: formatTemp(s.airTempC),
    airTrend: text.trend[s.airTempTrend],
    firstRain: first.known && first.value === i,
  }));
}

/** The compact strip's present sample. */
export type NowLine = { sky: string; rain: string; track: string; air: string };

const nowLine = (s: ForecastSample): NowLine => ({
  sky: text.weather[s.weather],
  rain: formatPct(s.rainPct),
  track: formatTemp(s.trackTempC),
  air: formatTemp(s.airTempC),
});

const firstRainPart = (s: ForecastSample): CellPart => ({
  text: s.offsetMin === 0 ? text.rainNow(formatPct(s.rainPct)) : text.rainAtOffset(formatPct(s.rainPct), formatMinutesAhead(s.offsetMin)),
});

/** Compact keeps now (the first sample) and the first rain; without a first rain, its part is empty with the reason. */
export function compactLines(forecast: WeatherForecast): { now: NowLine | undefined; firstRain: CellPart } {
  const first = forecast.samples[0];
  const index = forecast.firstRainIndex;
  const rain = index.known ? forecast.samples[index.value] : undefined;
  return {
    now: first === undefined ? undefined : nowLine(first),
    firstRain: !index.known ? unknownPart(index.reason) : rain === undefined ? unknownPart('notApplicable') : firstRainPart(rain),
  };
}

/** The note on the game's accuracy flag: `approximate` (compact `approx.`), nothing for a perfect forecast. */
export function accuracyNote(accuracy: WeatherForecast['accuracy'], mode: 'full' | 'compact'): string {
  return text.accuracyNote[mode][accuracy];
}
