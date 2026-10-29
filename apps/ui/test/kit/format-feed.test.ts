import { describe, expect, it } from 'vitest';
import { carId } from '@pitwall/domain';
import {
  formatCarNumber,
  formatCount,
  formatLoss,
  formatMillis,
  formatRate,
  formatSessionKind,
  formatTrack,
} from '../../src/kit/values/format.ts';

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [42, '42'],
    [42.4, '42'],
    [42.6, '43'],
    [1234567, '1234567'],
    [-3, '−3'],
    [-3.4, '−3'],
  ])('%s -> %s', (n, text) => {
    expect(formatCount(n)).toBe(text);
  });

  it('never renders negative zero', () => {
    expect(formatCount(-0)).toBe('0');
    expect(formatCount(-0.4)).toBe('0');
  });
});

describe('formatRate', () => {
  it.each([
    [0, '0/s'],
    [60, '60/s'],
    [59.6, '60/s'],
    [59.4, '59/s'],
    [-2, '−2/s'],
  ])('%s -> %s', (n, text) => {
    expect(formatRate(n)).toBe(text);
  });

  it('never renders negative zero', () => {
    expect(formatRate(-0.2)).toBe('0/s');
  });
});

describe('formatLoss', () => {
  it.each([
    [0, '0.0%'],
    [5, '5.0%'],
    [8.5, '8.5%'],
    [4.94, '4.9%'],
    [4.96, '5.0%'],
    [100, '100.0%'],
    [0.04, '0.0%'],
    [-1.25, '−1.3%'],
  ])('%s -> %s', (p, text) => {
    expect(formatLoss(p)).toBe(text);
  });

  it('keeps one decimal, so a value just under 5 % does not read as the whole number 5%', () => {
    expect(formatLoss(4.94)).not.toBe('5%');
    expect(formatLoss(4.94)).toBe('4.9%');
    expect(formatLoss(5)).toBe('5.0%');
  });
});

describe('formatMillis', () => {
  it.each([
    [0, '0 ms'],
    [12, '12 ms'],
    [12.4, '12 ms'],
    [12.6, '13 ms'],
    [1500, '1500 ms'],
    [-7, '−7 ms'],
  ])('%s -> %s', (ms, text) => {
    expect(formatMillis(ms)).toBe(text);
  });

  it('never renders negative zero', () => {
    expect(formatMillis(-0.3)).toBe('0 ms');
  });
});

describe('formatCarNumber', () => {
  it.each([
    [0, '#0'],
    [7, '#7'],
    [21, '#21'],
  ])('%s -> %s', (id, text) => {
    expect(formatCarNumber(carId(id))).toBe(text);
  });
});

describe('formatSessionKind', () => {
  it.each([
    ['unknown', 'unknown'],
    ['practice', 'practice'],
    ['qualifying', 'qualifying'],
    ['sprintShootout', 'sprint shootout'],
    ['race', 'race'],
    ['timeTrial', 'time trial'],
  ] as const)('%s -> %s', (kind, text) => {
    expect(formatSessionKind(kind)).toBe(text);
  });
});

describe('formatTrack', () => {
  it.each([
    [26, 'Zandvoort'],
    [1, 'track 1'],
    [8, 'track 8'],
    [-1, 'track -1'],
  ])('%s -> %s', (id, text) => {
    expect(formatTrack(id)).toBe(text);
  });
});
