// The unit formats of the car care group (spec 8.4, A.4; brainstorm rule "lap number vs lap count").
// Assumed: a non-finite input (a bug upstream, since missing data is `Known`) formats to the empty string, never `NaN`.
import { describe, expect, it } from 'vitest';
import {
  formatCelsius,
  formatDeltaMs,
  formatJoules,
  formatKg,
  formatLapNumber,
  formatLaps,
  formatPercent,
  formatPsi,
} from '../../src/kit/values/format.ts';

describe('formatLapNumber', () => {
  it.each([
    [23, 'L23'],
    [1, 'L1'],
    [0, 'L0'],
    [62, 'L62'],
  ])('%i -> %s', (n, text) => expect(formatLapNumber(n)).toBe(text));
  it('a non-finite number is empty', () => expect(formatLapNumber(Number.NaN)).toBe(''));
});

describe('formatLaps (a count always says laps)', () => {
  it.each([
    [1.8, '1.8 laps'],
    [17.64, '17.6 laps'],
    [0, '0.0 laps'],
    [1, '1.0 laps'],
    [-1.8, '-1.8 laps'],
    [-0.04, '0.0 laps'],
  ])('%f -> %s', (n, text) => expect(formatLaps(n)).toBe(text));
  it('a non-finite number is empty', () => expect(formatLaps(Number.NaN)).toBe(''));
});

describe('formatCelsius', () => {
  it.each([
    [94.6, '95°'],
    [98, '98°'],
    [0, '0°'],
    [-0.4, '0°'],
    [-3.6, '-4°'],
  ])('%f -> %s', (n, text) => expect(formatCelsius(n)).toBe(text));
  it('a non-finite number is empty', () => expect(formatCelsius(Number.NaN)).toBe(''));
});

describe('formatPercent', () => {
  it.each([
    [17.6, '18%'],
    [0, '0%'],
    [100, '100%'],
    [-0.4, '0%'],
    [-12.4, '-12%'],
  ])('%f -> %s', (n, text) => expect(formatPercent(n)).toBe(text));
  it('a non-finite number is empty', () => expect(formatPercent(Number.NaN)).toBe(''));
});

describe('formatPsi and formatKg (value only, the unit sits in the header or label)', () => {
  it.each([
    [23.456, '23.5'],
    [0, '0.0'],
    [-1.25, '-1.3'],
  ])('psi %f -> %s', (n, text) => expect(formatPsi(n)).toBe(text));
  it.each([
    [31.44, '31.4'],
    [0, '0.0'],
    [-0.5, '-0.5'],
  ])('kg %f -> %s', (n, text) => expect(formatKg(n)).toBe(text));
  it('a non-finite number is empty', () => {
    expect(formatPsi(Number.NaN)).toBe('');
    expect(formatKg(Number.NaN)).toBe('');
  });
});

describe('formatJoules (shown as MJ, one decimal)', () => {
  it.each([
    [2_100_000, '2.1 MJ'],
    [1_949_999, '1.9 MJ'],
    [0, '0.0 MJ'],
    [-400_000, '-0.4 MJ'],
    [4_000_000, '4.0 MJ'],
  ])('%i -> %s', (j, text) => expect(formatJoules(j)).toBe(text));
  it('a non-finite number is empty', () => expect(formatJoules(Number.NaN)).toBe(''));
});

describe('formatDeltaMs (signed seconds, three decimals)', () => {
  it.each([
    [412, '+0.412'],
    [-412, '-0.412'],
    [0, '+0.000'],
    [1234, '+1.234'],
    [-1234, '-1.234'],
  ])('%i -> %s', (ms, text) => expect(formatDeltaMs(ms)).toBe(text));
  it('a non-finite number is empty', () => expect(formatDeltaMs(Number.NaN)).toBe(''));
});
