import { describe, expect, it } from 'vitest';
import { deltaE100, lightness, parseOklch } from './colour.ts';

// Sanity checks for the test helper itself.
describe('colour helper', () => {
  it('white has OKLab lightness 1 and black 0', () => {
    expect(lightness('#ffffff')).toBeCloseTo(1, 3);
    expect(lightness('#000000')).toBeCloseTo(0, 3);
  });
  it('parses oklch()', () => {
    expect(parseOklch('oklch(0.72 0.09 250)')).toEqual({ L: 0.72, C: 0.09, h: 250 });
    expect(lightness('oklch(0.72 0.09 250)')).toBe(0.72);
  });
  it('delta E of white vs black is 100', () => {
    expect(deltaE100('#ffffff', '#000000')).toBeCloseTo(100, 1);
  });
});
