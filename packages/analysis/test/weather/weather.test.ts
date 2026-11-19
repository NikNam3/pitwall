// `weather` (spec 3.3, ruling R6; SP4.3c Task 14, O3a): `weather.forecast` holds `rain-outlook`'s `samplesAhead` as given
// (the forecast samples with `offsetMs ≥ 0`, sorted by `offsetMs`: `rain-outlook` reads the forecast, C43, so `weather`'s
// own copy of the filter is deleted and its rows 1 and 2 moved to `rain-outlook`'s tests); `accuracy` is the live
// state's `forecastAccuracy`; `firstRainIndex` is `rain-outlook`'s `firstRain.index` (C43: `weather` holds no rain
// threshold of its own), `notApplicable` if none (C3). Every case computes through the unit's guarded view (C41);
// `rain-outlook`'s output is given in `view.outputs` as a plain value.
import { known, unknown, type ForecastSample, type SessionState } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { engineView } from '../../../../test-support/builders/index.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { RAIN_OUTLOOK, type RainOutlook } from '../../src/rain-outlook/index.ts';
import { weatherCalculator } from '../../src/weather/calculator.ts';
import { WEATHER, type WeatherOutput } from '../../src/weather/index.ts';

/** `rain-outlook`'s output with the new fields of Task 14 (the samples ahead and the highest chance per remaining lap). */
type Outlook = RainOutlook & { samplesAhead: ForecastSample[]; maxChanceByLap: { lap: number; rainPct: number }[] };

/** A forecast sample `minutes` ahead with `rainPct` % rain chance; the other fields as a dry sample has them. */
const sample = (minutes: number, rainPct: number): ForecastSample => ({
  offsetMs: minutes * 60_000,
  weather: 'overcast',
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct,
});

/** `rain-outlook` without rain ahead, with these samples ahead. */
const dry = (samplesAhead: ForecastSample[] = []): Outlook => ({ firstRain: unknown('notApplicable'), withinHorizon: false, samplesAhead, maxChanceByLap: [] });

/** `rain-outlook` with its first rain at `index` (`minutes` ahead, `rainPct` as given), known at `at`, with these samples ahead. */
const rainAt = (samplesAhead: ForecastSample[], index: number, minutes: number, rainPct: number, at = 0): Outlook => ({
  firstRain: known({ index, offsetMs: minutes * 60_000, rainPct }, at),
  withinHorizon: minutes <= 10,
  samplesAhead,
  maxChanceByLap: [],
});

/** `compute` over a session with this forecast and accuracy and this `rain-outlook` output, through the guarded view (C41). */
const weather = (
  forecast: ForecastSample[],
  outlook: Outlook,
  forecastAccuracy: SessionState['forecastAccuracy'] = 'perfect',
  onRead?: (path: string) => void,
): WeatherOutput =>
  weatherCalculator.compute(
    guardedView(engineView({ session: { forecast, forecastAccuracy }, outputs: new Map([[RAIN_OUTLOOK, outlook]]) }), weatherCalculator.reads, {
      unit: WEATHER,
      ...(onRead !== undefined && { onRead }),
    }),
  );

describe('weather', () => {
  // rows 1 and 2 (sorted, offsetMs < 0 left out) moved to rain-outlook's samplesAhead (SP4.3c Task 14)
  it('1. samples are rain-outlook samplesAhead as given: weather sorts and filters nothing itself', () => {
    const ahead = [sample(0, 0), sample(5, 5), sample(15, 10), sample(30, 20)];
    // the live forecast holds more (out of order, one behind); weather publishes rain-outlook's reading of it
    const out = weather([sample(15, 10), sample(-5, 90), sample(0, 0), sample(30, 20), sample(5, 5)], dry(ahead));
    expect(out.samples).toEqual(ahead);
    // what rain-outlook hands over is what weather publishes, even where the live forecast says otherwise
    expect(weather([sample(0, 0)], dry([sample(5, 5), sample(0, 0)])).samples).toEqual([sample(5, 5), sample(0, 0)]);
  });

  it('3. no sample ahead: samples empty, firstRainIndex notApplicable', () => {
    expect(weather([], dry())).toEqual({ samples: [], accuracy: 'perfect', firstRainIndex: unknown('notApplicable') });
  });

  it('4. accuracy is the live state forecastAccuracy (perfect, approximate)', () => {
    expect(weather([sample(0, 0)], dry([sample(0, 0)]), 'perfect').accuracy).toBe('perfect');
    expect(weather([sample(0, 0)], dry([sample(0, 0)]), 'approximate').accuracy).toBe('approximate');
  });

  it('5. firstRainIndex is rain-outlook firstRain.index, known at its at', () => {
    const ahead = [sample(0, 0), sample(5, 45), sample(15, 60)];
    const out = weather(ahead, rainAt(ahead, 1, 5, 45, 1234));
    expect(out.firstRainIndex).toEqual(known(1, 1234));
  });

  it('6. rain-outlook firstRain notApplicable: firstRainIndex notApplicable', () => {
    const ahead = [sample(0, 0), sample(5, 10)];
    const out = weather(ahead, dry(ahead));
    expect(out.firstRainIndex).toEqual(unknown('notApplicable'));
  });

  it('7. no rain threshold in weather: rain-outlook says index 2 while index 1 has 90 % → firstRainIndex 2', () => {
    const ahead = [sample(0, 0), sample(5, 90), sample(15, 95)];
    const out = weather(ahead, rainAt(ahead, 2, 15, 95));
    expect(out.samples[1]?.rainPct).toBe(90);
    expect(out.firstRainIndex).toEqual(known(2, 0));
  });

  it('8. guarded view: reads only session and rain-outlook', () => {
    expect(weatherCalculator.id).toBe('weather');
    expect(weatherCalculator.kind).toBe('quick');
    expect(weatherCalculator.reads).toEqual(['session', { calculator: RAIN_OUTLOOK }]);
    const paths: string[] = [];
    const ahead = [sample(0, 0), sample(5, 45)];
    // computing through the guarded view throws on any undeclared read (C41)
    expect(() => weather(ahead, rainAt(ahead, 1, 5, 45), 'perfect', (p) => paths.push(p))).not.toThrow();
    expect(paths).toContain('live.session');
    expect(paths.filter((p) => !p.startsWith('live.session') && !p.startsWith('outputs') && p !== 'live')).toEqual([]);
  });
});
