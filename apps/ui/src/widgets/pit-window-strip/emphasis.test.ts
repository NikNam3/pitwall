// The pit-window strip's emphasis (C68; SP4.2 spec §4, mockup docs/design/2026-11-07-sp4.2/pit-window.html). Colour only
// to highlight: a window open now is white bold (the own-car role), a closed one faint, tyres at or past their limit amber.
// Contract assumed of `emphasis.ts` (both return `{ role: Role; bold: boolean }`, `Role` from theme/roles.ts):
//  - `windowEmphasis(state: PitWindowState)`: the band and laps of a window by `pit-window`'s state (C43: the display
//    judges nothing): `open` → `ownCar` bold; `closed` → `textFaint`; `before`, `lead` and `none` → `text`;
//  - `lastLapEmphasis(pastLimit: boolean)`: the fitted set's last lap by `pit-window`'s `stint.pastLimit` (the tyres at
//    or past their limit; the display compares no laps): amber (`warning`) bold when true, else `text`.
import { describe, expect, it } from 'vitest';
import { lastLapEmphasis, windowEmphasis } from './emphasis.ts';

describe('windowEmphasis', () => {
  it('makes a window open now white bold (the own-car role)', () => {
    expect(windowEmphasis('open')).toEqual({ role: 'ownCar', bold: true });
  });

  it('makes a closed window faint', () => {
    expect(windowEmphasis('closed')).toEqual({ role: 'textFaint', bold: false });
  });

  it('leaves a window ahead (before, in its lead) in the text colour', () => {
    expect(windowEmphasis('before')).toEqual({ role: 'text', bold: false });
    expect(windowEmphasis('lead')).toEqual({ role: 'text', bold: false });
  });

  it('leaves a set of the other type (no same-type window: none) in the text colour', () => {
    expect(windowEmphasis('none')).toEqual({ role: 'text', bold: false });
  });
});

describe('lastLapEmphasis', () => {
  it('makes the last lap amber bold while the tyres are at or past their limit (pastLimit)', () => {
    expect(lastLapEmphasis(true)).toEqual({ role: 'warning', bold: true });
  });

  it('keeps it in the text colour otherwise (also when a box stop closed the window)', () => {
    expect(lastLapEmphasis(false)).toEqual({ role: 'text', bold: false });
  });
});
