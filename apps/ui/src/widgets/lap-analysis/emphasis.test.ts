import { describe, expect, it } from 'vitest';
import { cellRole } from './emphasis.ts';

describe('cellRole', () => {
  it('is purple (best) for a session best, whoever holds it', () => {
    expect(cellRole('sessionBest')).toBe('best');
  });

  it('is undefined for any other best: every value of the table is a personal best, so no green', () => {
    expect(cellRole('none')).toBeUndefined();
  });
});
