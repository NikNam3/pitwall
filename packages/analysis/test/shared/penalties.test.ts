import { describe, expect, it } from 'vitest';
import type { PenaltyKind } from '@pitwall/domain';
import { penaltyClass, penaltyKind } from '../../src/shared/penalties.ts';

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

describe('penaltyKind', () => {
  it('names the ruling of every penalty code (F1 25 "Penalty types")', () => {
    const kinds: Record<number, PenaltyKind> = { 0: 'driveThrough', 1: 'stopGo', 2: 'grid', 4: 'time', 6: 'disqualified', 9: 'tyreRegulations' };
    for (const [code, kind] of Object.entries(kinds)) expect(penaltyKind(Number(code)), `code ${code}`).toBe(kind);
  });

  it('a warning, any other code, a missing or a non-numeric code has no kind', () => {
    for (const type of [3, 5, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 255]) expect(penaltyKind(type), `code ${type}`).toBeUndefined();
    expect(penaltyKind(undefined)).toBeUndefined();
    expect(penaltyKind('0')).toBeUndefined();
  });

  it('has a kind exactly for the codes penaltyClass counts as penalties', () => {
    for (let type = 0; type <= 255; type++) expect(penaltyKind(type) !== undefined, `code ${type}`).toBe(penaltyClass(type) === 'penalty');
  });
});
