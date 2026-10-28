import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatGap,
  formatKg,
  formatLapTime,
  formatPct,
  formatPsi,
  formatSector,
  formatTemp,
} from '../../src/kit/values/format.ts';

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
    [-500, '-0.500'],
    [65000, '+1:05.000'],
    [-65000, '-1:05.000'],
    [0, '+0.000'],
    [59999, '+59.999'],
  ])('%i -> %s', (ms, text) => expect(formatGap(ms)).toBe(text));

  it('always starts with a sign', () => {
    fc.assert(fc.property(fc.integer({ min: -3_600_000, max: 3_600_000 }), (ms) => /^[+-]/.test(formatGap(ms))));
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
    [-3.2, '-3°'],
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
    [-2, '-2.0'],
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
