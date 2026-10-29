// Formatters of the timing displays (final review 2a): signed laps between two cars, a race position, a plain s/lap rate.
import { describe, expect, it } from 'vitest';
import { formatLapsDown, formatPosition, formatSecondsPerLapPlain } from '../../src/kit/values/format.ts';

describe('formatLapsDown, signed', () => {
  it('keeps laps behind with a plus', () => {
    expect(formatLapsDown(1)).toBe('+1 lap');
    expect(formatLapsDown(2)).toBe('+2 laps');
  });
  it('gives laps ahead (negative) the true minus', () => {
    expect(formatLapsDown(-1)).toBe('−1 lap');
    expect(formatLapsDown(-3)).toBe('−3 laps');
  });
  it('is empty for a value that is not a number', () => {
    expect(formatLapsDown(Number.NaN)).toBe('');
  });
});

describe('formatPosition', () => {
  it('is P and the position', () => {
    expect(formatPosition(7)).toBe('P7');
    expect(formatPosition(15)).toBe('P15');
  });
  it('is empty for a value that is not a number', () => {
    expect(formatPosition(Number.NaN)).toBe('');
  });
});

describe('formatSecondsPerLapPlain', () => {
  it('is seconds per lap to two decimals without a forced plus', () => {
    expect(formatSecondsPerLapPlain(310)).toBe('0.31 s/lap');
    expect(formatSecondsPerLapPlain(-120)).toBe('−0.12 s/lap');
  });
  it('is empty for a value that is not a number', () => {
    expect(formatSecondsPerLapPlain(Number.NaN)).toBe('');
  });
});
