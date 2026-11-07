// The pit-window strip's emphasis (C68; SP4.2 spec §4, mockup docs/design/2026-11-07-sp4.2/pit-window.html). Colour only
// to highlight: a window open now is white bold (the own-car role), a closed one faint, tyres at or past their limit amber.
// Contract assumed of `emphasis.ts` (both return `{ role: Role; bold: boolean }`, `Role` from theme/roles.ts):
//  - `windowEmphasis(state: PitWindowState)`: the band and laps of a window by `pit-window`'s state (C43: the display
//    judges nothing): `open` → `ownCar` bold; `closed` → `textFaint`; `before`, `lead` and `none` → `text`;
//  - `lastLapEmphasis(state: PitWindowState, latest: number, currentLap: number)`: the fitted set's last lap; amber
//    (`warning`) bold when `state` is `closed` and `latest ≤ currentLap` (the Task 5 ruling: the tyres are at or past
//    their limit), else `text`.
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
  it('makes the last lap amber bold once the tyres are past their life (closed, latest before now)', () => {
    expect(lastLapEmphasis('closed', 31, 33)).toEqual({ role: 'warning', bold: true });
  });

  it('makes it amber at the limit: closed with latest = now (lapsToLimit < 1, Task 5 ruling)', () => {
    expect(lastLapEmphasis('closed', 23, 23)).toEqual({ role: 'warning', bold: true });
  });

  it('keeps it in the text colour when closed by a stop before the limit (latest still ahead)', () => {
    expect(lastLapEmphasis('closed', 31, 20)).toEqual({ role: 'text', bold: false });
  });

  it('keeps it in the text colour while the window is open, ahead or none', () => {
    expect(lastLapEmphasis('open', 31, 23)).toEqual({ role: 'text', bold: false });
    expect(lastLapEmphasis('open', 23, 23)).toEqual({ role: 'text', bold: false });
    expect(lastLapEmphasis('before', 31, 15)).toEqual({ role: 'text', bold: false });
    expect(lastLapEmphasis('none', 51, 41)).toEqual({ role: 'text', bold: false });
  });
});
