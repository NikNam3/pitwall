import { describe, expect, it } from 'vitest';
import { formatMinutesTenths } from '../../src/kit/values/format.ts';

describe('formatMinutesTenths', () => {
  it('formats minutes and tenths', () => {
    expect(formatMinutesTenths(1_128_600)).toBe('18:48.6');
  });
  it('formats a whole minute', () => {
    expect(formatMinutesTenths(60_000)).toBe('1:00.0');
  });
  it('rounds 59 999 ms up into the next minute', () => {
    expect(formatMinutesTenths(59_999)).toBe('1:00.0');
  });
});
