import type { FiaFlag } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { bandRole, flagRole, sectorEmphasis } from '../../src/emphasis/index.ts';

describe('sectorEmphasis', () => {
  it('overall best is best', () => {
    expect(sectorEmphasis({ timeMs: 30000, personalBestMs: 30500, overallBestMs: 30000 })).toBe('best');
  });
  it('equal to overall best is best, even without a personal best', () => {
    expect(sectorEmphasis({ timeMs: 30000, overallBestMs: 30000 })).toBe('best');
  });
  it('faster than overall best is best', () => {
    expect(sectorEmphasis({ timeMs: 29900, personalBestMs: 30000, overallBestMs: 30000 })).toBe('best');
  });
  it('personal best that is not overall best is personalBest', () => {
    expect(sectorEmphasis({ timeMs: 30200, personalBestMs: 30200, overallBestMs: 30000 })).toBe('personalBest');
    expect(sectorEmphasis({ timeMs: 30200, personalBestMs: 30200 })).toBe('personalBest');
  });
  it('slower than both is neutral', () => {
    expect(sectorEmphasis({ timeMs: 31000, personalBestMs: 30200, overallBestMs: 30000 })).toBeUndefined();
    expect(sectorEmphasis({ timeMs: 31000 })).toBeUndefined();
  });
});

describe('flagRole', () => {
  const expected: Record<FiaFlag, ReturnType<typeof flagRole>> = {
    unknown: undefined,
    none: undefined,
    green: undefined, // flags are coloured only when not green
    blue: 'flagBlue',
    yellow: 'flagYellow',
  };
  for (const [flag, role] of Object.entries(expected) as [FiaFlag, ReturnType<typeof flagRole>][]) {
    it(`${flag} -> ${String(role)}`, () => expect(flagRole(flag)).toBe(role));
  }
});

describe('bandRole', () => {
  it('in is neutral; low and high are warning', () => {
    expect(bandRole('in')).toBeUndefined();
    expect(bandRole('low')).toBe('warning');
    expect(bandRole('high')).toBe('warning');
  });
});
