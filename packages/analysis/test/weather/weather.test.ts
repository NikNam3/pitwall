// `weather` (spec 3.3, ruling R6): `weather.forecast` holds the session's forecast samples with `offsetMin ≥ 0`, sorted
// by `offsetMin`; `accuracy` is the live state's `forecastAccuracy`; `firstRainIndex` is `rain-outlook`'s `firstRain.index`
// (C43: `weather` holds no rain threshold of its own), `notApplicable` if none (C3). Every case computes through the
// unit's guarded view (C41); `rain-outlook`'s output is given in `view.outputs` as a plain value.
import { known, unknown, type ForecastSample, type SessionState } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { engineView } from '../../../../test-support/builders/index.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { RAIN_OUTLOOK, type RainOutlook } from '../../src/rain-outlook/index.ts';
import { weatherCalculator } from '../../src/weather/calculator.ts';
import { WEATHER, type WeatherOutput } from '../../src/weather/index.ts';

/** A forecast sample `offsetMin` minutes ahead with `rainPct` % rain chance; the other fields as a dry sample has them. */
const sample = (offsetMin: number, rainPct: number): ForecastSample => ({
  offsetMin,
  weather: 'overcast',
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct,
});

/** `rain-outlook` without rain ahead. */
const DRY: RainOutlook = { firstRain: unknown('notApplicable'), withinHorizon: false };

/** `rain-outlook` with its first rain at `index` (`offsetMin`, `rainPct` as given), known at `at`. */
const rainAt = (index: number, offsetMin: number, rainPct: number, at = 0): RainOutlook => ({
  firstRain: known({ index, offsetMin, rainPct }, at),
  withinHorizon: offsetMin <= 10,
});

/** `compute` over a session with this forecast and accuracy and this `rain-outlook` output, through the guarded view (C41). */
const weather = (
  forecast: ForecastSample[],
  outlook: RainOutlook = DRY,
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
  it('1. samples out of order: the output holds them sorted by offsetMin', () => {
    const out = weather([sample(15, 10), sample(0, 0), sample(30, 20), sample(5, 5)]);
    expect(out.samples).toEqual([sample(0, 0), sample(5, 5), sample(15, 10), sample(30, 20)]);
  });

  it('2. a sample with offsetMin < 0 is left out (R6)', () => {
    const out = weather([sample(5, 5), sample(-5, 90), sample(0, 0)]);
    expect(out.samples).toEqual([sample(0, 0), sample(5, 5)]);
  });

  it('3. no sample: samples empty, firstRainIndex notApplicable', () => {
    expect(weather([])).toEqual({ samples: [], accuracy: 'perfect', firstRainIndex: unknown('notApplicable') });
  });

  it('4. accuracy is the live state forecastAccuracy (perfect, approximate)', () => {
    expect(weather([sample(0, 0)], DRY, 'perfect').accuracy).toBe('perfect');
    expect(weather([sample(0, 0)], DRY, 'approximate').accuracy).toBe('approximate');
  });

  it('5. firstRainIndex is rain-outlook firstRain.index, known at its at', () => {
    const out = weather([sample(0, 0), sample(5, 45), sample(15, 60)], rainAt(1, 5, 45, 1234));
    expect(out.firstRainIndex).toEqual(known(1, 1234));
  });

  it('6. rain-outlook firstRain notApplicable: firstRainIndex notApplicable', () => {
    const out = weather([sample(0, 0), sample(5, 10)], DRY);
    expect(out.firstRainIndex).toEqual(unknown('notApplicable'));
  });

  it('7. no rain threshold in weather: rain-outlook says index 2 while index 1 has 90 % → firstRainIndex 2', () => {
    const out = weather([sample(0, 0), sample(5, 90), sample(15, 95)], rainAt(2, 15, 95));
    expect(out.samples[1]?.rainPct).toBe(90);
    expect(out.firstRainIndex).toEqual(known(2, 0));
  });

  it('8. guarded view: reads only session and rain-outlook', () => {
    expect(weatherCalculator.id).toBe('weather');
    expect(weatherCalculator.kind).toBe('quick');
    expect(weatherCalculator.reads).toEqual(['session', { calculator: RAIN_OUTLOOK }]);
    const paths: string[] = [];
    // computing through the guarded view throws on any undeclared read (C41)
    expect(() => weather([sample(0, 0), sample(5, 45)], rainAt(1, 5, 45), 'perfect', (p) => paths.push(p))).not.toThrow();
    expect(paths).toContain('live.session');
    expect(paths.filter((p) => !p.startsWith('live.session') && !p.startsWith('outputs') && p !== 'live')).toEqual([]);
  });
});
