import { describe, expect, it } from 'vitest';
import { cellRole } from './emphasis.ts';

describe('cellRole', () => {
  it('is purple (best) for a session best, for our cars and for rivals', () => {
    expect(cellRole('sessionBest', true)).toBe('best');
    expect(cellRole('sessionBest', false)).toBe('best');
  });

  it('is green (personalBest) for a personal best of our cars only', () => {
    expect(cellRole('personalBest', true)).toBe('personalBest');
    expect(cellRole('personalBest', false)).toBeUndefined();
  });

  it('is undefined without a status', () => {
    expect(cellRole('none', true)).toBeUndefined();
    expect(cellRole('none', false)).toBeUndefined();
  });
});
