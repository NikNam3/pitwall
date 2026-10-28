import { describe, expect, it } from 'vitest';
import { intervalMs } from '../../src/hub/throttle.ts';

describe('intervalMs', () => {
  it('is 1000 / maxHz', () => {
    expect(intervalMs(2)).toBe(500);
    expect(intervalMs(10)).toBe(100);
    expect(intervalMs(60)).toBeCloseTo(16.667, 3);
  });
  it('is 0 for Infinity (no throttling)', () => {
    expect(intervalMs(Infinity)).toBe(0);
  });
});
