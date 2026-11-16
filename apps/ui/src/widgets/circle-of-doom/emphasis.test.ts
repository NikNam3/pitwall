// The circle-of-doom's emphasis (C68; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html): our car and our teammate
// white (`ownCar`; the teammate a ring), every other car grey (`textDim`); the current condition's ghost white, the
// others faint. Colour only to highlight. Contract assumed of `emphasis.ts`:
//  - `carRole(kind: 'mate' | 'rival'): Role`; `ownRole(): Role`; `ghostRole(on: boolean): Role`.
import { describe, expect, it } from 'vitest';
import { carRole, ghostRole, ownRole } from './emphasis.ts';

describe('carRole', () => {
  it('draws our teammate white and a rival grey', () => {
    expect(carRole('mate')).toBe('ownCar');
    expect(carRole('rival')).toBe('textDim');
  });
});

describe('ownRole', () => {
  it('draws our car white', () => {
    expect(ownRole()).toBe('ownCar');
  });
});

describe('ghostRole', () => {
  it('draws the current condition\'s ghost white and the others faint', () => {
    expect(ghostRole(true)).toBe('ownCar');
    expect(ghostRole(false)).toBe('textFaint');
  });
});
