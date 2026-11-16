// The Box call's emphasis (C68; mockup docs/design/2026-11-16-sp4.3d/sc-card.html, gen.mjs `block`): the condition that
// is out is named in the warning role (amber); each block's best row is white bold (`ownCar`, the mockup's `hi`); a
// ΔPOS below −1 place is amber; "no set" is faint. Colour only to highlight: nothing else takes a role.
// Contract assumed of `emphasis.ts`: `outRole(): Role`, `bestRole(best: boolean): Role | undefined`,
// `deltaRole(ePosDelta: number): Role | undefined`, `noSetRole(): Role`.
import { describe, expect, it } from 'vitest';
import { bestRole, deltaRole, noSetRole, outRole } from './emphasis.ts';

describe('Box call emphasis', () => {
  it('names the condition that is out in the warning role', () => {
    expect(outRole()).toBe('warning');
  });

  it('makes the best row white (ownCar); every other row keeps the inherited colour', () => {
    expect(bestRole(true)).toBe('ownCar');
    expect(bestRole(false)).toBeUndefined();
  });

  it('a ΔPOS below −1 place is amber; −1 itself and above take no role', () => {
    expect(deltaRole(-1.85)).toBe('warning');
    expect(deltaRole(-1.01)).toBe('warning');
    expect(deltaRole(-1)).toBeUndefined();
    expect(deltaRole(-0.48)).toBeUndefined();
    expect(deltaRole(0.72)).toBeUndefined();
  });

  it('"no set" is faint', () => {
    expect(noSetRole()).toBe('textFaint');
  });
});
