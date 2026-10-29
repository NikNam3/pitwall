import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatDeltaPct,
  formatGap,
  formatMJ,
  formatPenaltyMs,
  formatLapsDown,
  formatPlace,
  formatSeconds,
  formatSecondsPerLap,
  formatSignedMJ,
  formatSignedSeconds,
  formatWarnings,
  formatKg,
  formatKgUnit,
  formatLapNumber,
  formatWhole,
  formatWholeLaps,
  formatLapTime,
  formatPct,
  formatPsi,
  formatSector,
  formatSessionClock,
  formatTemp,
  fixed,
  formatCount,
  formatGapTick,
  formatLaps,
  formatLoss,
  formatMillis,
  formatPercent,
  formatCelsius,
  formatRate,
  formatKgPerLap,
  MINUS,
} from '../../src/kit/values/format.ts';

describe('one minus glyph (U+2212) everywhere', () => {
  const formatters: Array<[string, (n: number) => string]> = [
    ['fixed', (n) => fixed(n, 1)],
    ['formatTemp', formatTemp],
    ['formatCelsius', formatCelsius],
    ['formatPct', formatPct],
    ['formatPercent', formatPercent],
    ['formatCount', formatCount],
    ['formatRate', formatRate],
    ['formatLoss', formatLoss],
    ['formatMillis', formatMillis],
    ['formatPsi', formatPsi],
    ['formatKg', formatKg],
    ['formatKgUnit', formatKgUnit],
    ['formatKgPerLap', formatKgPerLap],
    ['formatLaps', formatLaps],
    ['formatWhole', formatWhole],
    ['formatWholeLaps', formatWholeLaps],
    ['formatPenaltyMs', (n) => formatPenaltyMs(n * 1000)],
    ['formatDeltaPct', formatDeltaPct],
    ['formatGapTick', (n) => formatGapTick(-n)],
    ['formatMJ', (n) => formatMJ(n * 1e6)],
    ['formatSeconds', (n) => formatSeconds(n * 1000, 1)],
  ];
  it.each(formatters)('%s never prints an ASCII hyphen for a negative value', (_name, format) => {
    fc.assert(fc.property(fc.double({ min: -1000, max: -0.0001, noNaN: true }), (n) => !format(n).includes('-')));
  });
  it.each(formatters)('%s prints the true minus for a clearly negative value', (_name, format) => {
    expect(format(-7)).toContain(MINUS);
  });
});

describe('formatLapTime', () => {
  it.each([
    [83456, '1:23.456'],
    [0, '0:00.000'],
    [59999, '0:59.999'],
    [60000, '1:00.000'],
    [605001, '10:05.001'],
  ])('%i -> %s', (ms, text) => expect(formatLapTime(ms)).toBe(text));
});

describe('formatGap', () => {
  it.each([
    [1234, '+1.234'],
    [-500, '−0.500'],
    [65000, '+1:05.000'],
    [-65000, '−1:05.000'],
    [0, '+0.000'],
    [59999, '+59.999'],
  ])('%i -> %s', (ms, text) => expect(formatGap(ms)).toBe(text));

  it('always starts with a sign', () => {
    fc.assert(fc.property(fc.integer({ min: -3_600_000, max: 3_600_000 }), (ms) => /^[+−]/.test(formatGap(ms))));
  });
});

describe('formatSector', () => {
  it.each([
    [23456, '23.456'],
    [0, '0.000'],
    [5001, '5.001'],
  ])('%i -> %s', (ms, text) => expect(formatSector(ms)).toBe(text));
});

describe('formatTemp', () => {
  it.each([
    [94.6, '95°'],
    [94.4, '94°'],
    [0, '0°'],
    [-3.2, '−3°'],
  ])('%f -> %s', (c, text) => expect(formatTemp(c)).toBe(text));
});

describe('formatPsi', () => {
  it.each([
    [23.456, '23.5'],
    [0, '0.0'],
    [30, '30.0'],
  ])('%f -> %s', (p, text) => expect(formatPsi(p)).toBe(text));
});

describe('formatKg', () => {
  it.each([
    [10, '10.0'],
    [0, '0.0'],
    [1.26, '1.3'],
    [-2, '−2.0'],
  ] as Array<[number, string]>)('%f -> %s', (k, text) => expect(formatKg(k)).toBe(text));
});

describe('formatPct', () => {
  it.each([
    [12.34, '12%'],
    [0, '0%'],
    [99.5, '100%'],
    [100, '100%'],
  ])('%f -> %s', (p, text) => expect(formatPct(p)).toBe(text));
});

describe('formatSessionClock', () => {
  it.each([
    [4_324_000, '1:12:04'],
    [471_000, '0:07:51'],
    [0, '0:00:00'],
    [59_999, '0:00:59'],
    [3_600_000, '1:00:00'],
    [36_000_000, '10:00:00'],
  ])('%i ms -> %s', (ms, text) => expect(formatSessionClock(ms)).toBe(text));
});

describe('formatWholeLaps', () => {
  it.each([[12.9, '12'], [0.4, '0'], [3, '3'], [Number.NaN, '']] as Array<[number, string]>)('%f -> %s', (n, text) =>
    expect(formatWholeLaps(n)).toBe(text));
});

describe('formatKgUnit', () => {
  it.each([[10, '10.0 kg'], [1.26, '1.3 kg'], [Number.NaN, '']] as Array<[number, string]>)('%f -> %s', (k, text) =>
    expect(formatKgUnit(k)).toBe(text));
});

describe('formatWhole', () => {
  it.each([[94.6, '95'], [-0.2, '0'], [7, '7'], [Number.POSITIVE_INFINITY, '']] as Array<[number, string]>)('%f -> %s', (n, text) =>
    expect(formatWhole(n)).toBe(text));
});

describe('formatDeltaPct', () => {
  it.each([[12.4, '+12 %'], [0, '+0 %'], [-0.2, '+0 %'], [-3, '\u22123 %'], [Number.NaN, '']] as Array<[number, string]>)('%f -> %s', (n, text) =>
    expect(formatDeltaPct(n)).toBe(text));
});

describe('formatLapNumber', () => {
  it.each([[9, 2, 'L09'], [23, 2, 'L23'], [123, 2, 'L123'], [Number.NaN, 2, '']] as Array<[number, number, string]>)('%f/%i -> %s', (n, w, text) =>
    expect(formatLapNumber(n, w)).toBe(text));
});

describe('formatSecondsPerLap', () => {
  it.each([[120, '+0.12 s/lap'], [0, '+0.00 s/lap'], [1500, '+1.50 s/lap'], [Number.NaN, '']] as Array<[number, string]>)('%f -> %s', (ms, text) =>
    expect(formatSecondsPerLap(ms)).toBe(text));
  it('a negative loss carries a minus sign', () => expect(formatSecondsPerLap(-120)).toMatch(/^[-\u2212]0\.12 s\/lap$/));
});

describe('formatSeconds (plain seconds from ms)', () => {
  it.each([
    [4100, 1, '4.1'],
    [4149, 1, '4.1'],
    [120, 2, '0.12'],
    [-4100, 1, '−4.1'],
    [-20, 1, '0.0'],
    [0, 3, '0.000'],
  ])('%i ms at %i decimals -> %s', (ms, decimals, text) => expect(formatSeconds(ms, decimals)).toBe(text));
  it('a non-finite number is empty', () => expect(formatSeconds(Number.NaN, 1)).toBe(''));
});

describe('formatSignedSeconds (signed seconds from ms)', () => {
  it.each([
    [120, 2, '+0.12'],
    [-120, 2, '−0.12'],
    [-4, 2, '+0.00'],
    [0, 1, '+0.0'],
    [3199, 3, '+3.199'],
    [-1900, 1, '−1.9'],
  ])('%i ms at %i decimals -> %s', (ms, decimals, text) => expect(formatSignedSeconds(ms, decimals)).toBe(text));
  it('a non-finite number is empty', () => expect(formatSignedSeconds(Number.NaN, 1)).toBe(''));
});

describe('formatSecondsPerLap', () => {
  it.each([
    [120, '+0.12 s/lap'],
    [-310, '−0.31 s/lap'],
    [0, '+0.00 s/lap'],
  ])('%i -> %s', (ms, text) => expect(formatSecondsPerLap(ms)).toBe(text));
  it('a non-finite number is empty', () => expect(formatSecondsPerLap(Number.NaN)).toBe(''));
});

describe('formatMJ and formatSignedMJ (joules as MJ, one decimal)', () => {
  it.each([
    [2_100_000, '2.1'],
    [0, '0.0'],
    [-400_000, '−0.4'],
    [-10_000, '0.0'],
  ])('formatMJ %i -> %s', (j, text) => expect(formatMJ(j)).toBe(text));
  it.each([
    [1_200_000, '+1.2'],
    [-400_000, '−0.4'],
    [0, '0.0'],
    [30_000, '0.0'],
    [-30_000, '0.0'],
  ])('formatSignedMJ %i -> %s', (j, text) => expect(formatSignedMJ(j)).toBe(text));
  it('a non-finite number is empty', () => {
    expect(formatMJ(Number.NaN)).toBe('');
    expect(formatSignedMJ(Number.NaN)).toBe('');
  });
});

describe('tower cell formats', () => {
  it('laps down', () => {
    expect(formatLapsDown(1)).toBe('+1 lap');
    expect(formatLapsDown(3)).toBe('+3 laps');
  });
  it('a penalty from ms to whole seconds', () => {
    expect(formatPenaltyMs(5000)).toBe('5s');
    expect(formatPenaltyMs(9600)).toBe('10s');
  });
  it('warnings', () => expect(formatWarnings(2)).toBe('2w'));
  it('a place; unknown is empty', () => {
    expect(formatPlace(7)).toBe('7');
    expect(formatPlace(undefined)).toBe('');
  });
});
