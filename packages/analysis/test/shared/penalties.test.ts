import { describe, expect, it } from 'vitest';
import { penaltyClass } from '../../src/shared/penalties.ts';

describe('penaltyClass', () => {
  it('drive-through, stop-go, grid, time, disqualification and tyre regulations are penalties', () => {
    for (const type of [0, 1, 2, 4, 6, 9]) expect(penaltyClass(type)).toBe('penalty');
  });

  it('5 is a warning', () => {
    expect(penaltyClass(5)).toBe('warning');
  });

  it('reminders, formation-lap removal, timers, lap invalidations and retirement are neither', () => {
    for (const type of [3, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]) expect(penaltyClass(type)).toBe('none');
  });

  it('a missing or non-numeric code is neither', () => {
    expect(penaltyClass(undefined)).toBe('none');
    expect(penaltyClass('4')).toBe('none');
  });
});
