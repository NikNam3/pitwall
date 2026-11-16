// The Field plans emphasis (C68; SP4.3d spec §6.4; mockup docs/design/2026-11-16-sp4.3d/strategy-overview.html: "KUH has
// the bar, LIN is white"; colour only to highlight). Contract assumed of `emphasis.ts`:
//  - `rowEmphasis(kind: 'own' | 'mate' | 'rival'): { role: Role; bold: boolean; bar: boolean }`: the link's car white
//    bold with the bar, the teammate white bold without it, a rival in the text colour;
//  - `solidRole(own: boolean): Role`: a stint drawn solid in the lane, white (`ownCar`) on our rows, dim on a rival's.
import { describe, expect, it } from 'vitest';
import { rowEmphasis, solidRole } from './emphasis.ts';

describe('rowEmphasis', () => {
  it('gives our row the bar, white bold', () => {
    expect(rowEmphasis('own')).toEqual({ role: 'ownCar', bold: true, bar: true });
  });

  it('makes the teammate white bold without the bar', () => {
    expect(rowEmphasis('mate')).toEqual({ role: 'ownCar', bold: true, bar: false });
  });

  it('leaves a rival in the text colour', () => {
    expect(rowEmphasis('rival')).toEqual({ role: 'text', bold: false, bar: false });
  });
});

describe('solidRole', () => {
  it('draws our stints white and a rival\'s dim', () => {
    expect(solidRole(true)).toBe('ownCar');
    expect(solidRole(false)).toBe('textDim');
  });
});
