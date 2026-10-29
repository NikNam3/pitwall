import { describe, expect, it } from 'vitest';
import { cutOffRole, deltaRole, finishRole } from './emphasis.ts';

describe('cutOffRole', () => {
  it('is critical for a negative margin (outside the cut-off)', () => {
    expect(cutOffRole(-305)).toBe('critical');
    expect(cutOffRole(-1)).toBe('critical');
  });
  it('is undefined for a zero or positive margin', () => {
    expect(cutOffRole(0)).toBeUndefined();
    expect(cutOffRole(594)).toBeUndefined();
  });
});

describe('finishRole', () => {
  it('is critical when no further lap can start (margin below zero)', () => {
    expect(finishRole(-4100)).toBe('critical');
    expect(finishRole(-1)).toBe('critical');
  });
  it('is undefined for a zero or positive margin', () => {
    expect(finishRole(0)).toBeUndefined();
    expect(finishRole(38_200)).toBeUndefined();
  });
});

describe('deltaRole', () => {
  it('is the personal-best role for a delta below zero of our car (a new personal best)', () => {
    expect(deltaRole(-118, true)).toBe('personalBest');
    expect(deltaRole(-1, true)).toBe('personalBest');
  });
  it('is undefined for a zero or positive delta', () => {
    expect(deltaRole(0, true)).toBeUndefined();
    expect(deltaRole(781, true)).toBeUndefined();
  });
  it('is undefined for a rival projected faster than its best: green is for our cars only', () => {
    expect(deltaRole(-118, false)).toBeUndefined();
  });
});
