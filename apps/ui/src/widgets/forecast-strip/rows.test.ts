// The forecast strip's rows (spec 4; C65: the display formats and maps, it computes nothing; mockup 5-weather.html).
// Contract assumed of `rows.ts`:
//  - `type SampleColumn = { offset: string; sky: string; rain: string; track: string; trackTrend: string; air: string;
//    airTrend: string; firstRain: boolean }`: the minutes from now (`now` for 0, else `+5`, wording in text.ts, the
//    number from the kit), the weather word (`clear`, `cloud`, `overc.`, `l.rain`, `h.rain`, `storm`; text.ts), the rain
//    chance as a bare whole number (the row label carries the `%`; kit `formatWhole`), the temperatures in whole degrees
//    (kit `formatTemp`), each trend as the game gives it, `▲` up, `▼` down, '' flat (text.ts), and whether this sample is
//    the topic's `firstRainIndex` (C43: no threshold in the widget);
//  - `fullColumns(forecast: WeatherForecast, maxColumns?: number): SampleColumn[]`: one column per sample in the
//    topic's order; with `maxColumns` (the columns the panel's width holds), the earliest that fit;
//  - `compactLines(forecast: WeatherForecast): { now: { sky: string; rain: string; track: string; air: string } |
//    undefined; firstRain: CellPart }`: compact keeps now (the first sample: weather word, rain as `5%` with kit
//    `formatPct`, temperatures as `34°`) and the first rain only, `45% at +30 min` (`45% now` at offset 0), or empty with
//    the unknown's reason (kit `knownPart`); no sample: `now` undefined;
//  - `accuracyNote(accuracy: WeatherForecast['accuracy'], mode: 'full' | 'compact'): string`: `approximate` (compact
//    `approx.`) for the game's approximate flag, '' for perfect.
import { describe, expect, it } from 'vitest';
import { unknown } from '@pitwall/domain';
import { drySamples, forecast, noRain, rainAt, rainSamples, sample } from './fixtures.ts';
import { accuracyNote, compactLines, fullColumns } from './rows.ts';

const rain = forecast(rainSamples, rainAt(4), 'approximate');
const dry = forecast(drySamples);

describe('fullColumns', () => {
  it('gives one column per sample, labelled by the minutes from now', () => {
    expect(fullColumns(rain).map((c) => c.offset)).toEqual(['now', '+5', '+10', '+15', '+30', '+45', '+60']);
  });

  it('writes the weather word of each sample', () => {
    expect(fullColumns(rain).map((c) => c.sky)).toEqual(['cloud', 'overc.', 'overc.', 'overc.', 'l.rain', 'l.rain', 'h.rain']);
    const all = forecast((['clear', 'lightCloud', 'overcast', 'lightRain', 'heavyRain', 'storm'] as const).map((w, i) => sample(i * 5, w, 0, 30, 20)));
    expect(fullColumns(all).map((c) => c.sky)).toEqual(['clear', 'cloud', 'overc.', 'l.rain', 'h.rain', 'storm']);
  });

  it('writes the rain chance as a bare whole number (the row label carries the %)', () => {
    expect(fullColumns(rain).map((c) => c.rain)).toEqual(['5', '10', '20', '30', '45', '60', '75']);
  });

  it('writes the track and air temperatures in whole degrees', () => {
    expect(fullColumns(rain).map((c) => c.track)).toEqual(['34°', '33°', '32°', '31°', '28°', '26°', '24°']);
    expect(fullColumns(rain).map((c) => c.air)).toEqual(['21°', '21°', '20°', '20°', '19°', '18°', '18°']);
    expect(fullColumns(forecast([sample(0, 'clear', 0, 33.6, 20.4)]))[0]).toMatchObject({ track: '34°', air: '20°' });
  });

  it('writes the game\'s trends as ▲ up, ▼ down, nothing flat', () => {
    expect(fullColumns(rain).map((c) => c.trackTrend)).toEqual(['', '▼', '▼', '▼', '▼', '▼', '▼']);
    expect(fullColumns(rain).map((c) => c.airTrend)).toEqual(['', '', '▼', '', '▼', '▼', '']);
    expect(fullColumns(dry).map((c) => c.trackTrend)).toEqual(['', '▲', '', '▲', '', '▼', '▼']);
  });

  it('marks the sample at the topic\'s firstRainIndex, and only it', () => {
    expect(fullColumns(rain).map((c) => c.firstRain)).toEqual([false, false, false, false, true, false, false]);
  });

  it('marks no sample when the topic has no first rain', () => {
    expect(fullColumns(dry).map((c) => c.firstRain)).toEqual([false, false, false, false, false, false, false]);
  });

  it('holds no rain threshold: it marks the index the topic gives, whatever the rain chance', () => {
    expect(fullColumns(forecast(rainSamples, rainAt(1))).map((c) => c.firstRain)).toEqual([false, true, false, false, false, false, false]);
    expect(fullColumns(forecast(rainSamples, noRain)).some((c) => c.firstRain)).toBe(false);
  });

  it('keeps the earliest samples that fit in maxColumns', () => {
    expect(fullColumns(rain, 4).map((c) => c.offset)).toEqual(['now', '+5', '+10', '+15']);
    expect(fullColumns(rain, 7)).toEqual(fullColumns(rain));
    expect(fullColumns(rain, 12)).toEqual(fullColumns(rain));
  });

  it('has no column without samples', () => {
    expect(fullColumns(forecast([]))).toEqual([]);
  });
});

describe('compactLines', () => {
  it('keeps now: the first sample\'s weather word, rain with its % and the two temperatures', () => {
    expect(compactLines(rain).now).toEqual({ sky: 'cloud', rain: '5%', track: '34°', air: '21°' });
    expect(compactLines(dry).now).toEqual({ sky: 'clear', rain: '0%', track: '41°', air: '26°' });
  });

  it('keeps the first rain: its chance and minutes from now', () => {
    expect(compactLines(rain).firstRain).toEqual({ text: '45% at +30 min' });
  });

  it('says the first rain is now when it is the first sample', () => {
    const now = forecast([sample(0, 'lightRain', 55, 28, 19), ...rainSamples.slice(1)], rainAt(0));
    expect(compactLines(now).firstRain).toEqual({ text: '55% now' });
  });

  it('leaves the first rain empty with its reason when the topic has none', () => {
    expect(compactLines(dry).firstRain).toEqual({ text: '', reason: 'notApplicable' });
    expect(compactLines(forecast(drySamples, unknown('notReceived'))).firstRain).toEqual({ text: '', reason: 'notReceived' });
  });

  it('has no now without samples, and the first rain empty with its reason', () => {
    expect(compactLines(forecast([]))).toEqual({ now: undefined, firstRain: { text: '', reason: 'notApplicable' } });
  });
});

describe('accuracyNote', () => {
  it('notes the game\'s approximate flag: approximate in full, approx. in compact', () => {
    expect(accuracyNote('approximate', 'full')).toBe('approximate');
    expect(accuracyNote('approximate', 'compact')).toBe('approx.');
  });

  it('notes nothing for a perfect forecast', () => {
    expect(accuracyNote('perfect', 'full')).toBe('');
    expect(accuracyNote('perfect', 'compact')).toBe('');
  });
});
