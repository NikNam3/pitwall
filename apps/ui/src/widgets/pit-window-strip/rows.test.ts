// The pit-window strip's rows (SP4.2 spec §4; C65: the display formats and maps, it computes nothing; K16: the other
// type's sets only on the panel option `otherType`). Contract assumed of `rows.ts`:
//  - `visibleSets(window: PitWindow, showOther: boolean): PitWindowSet[]`: the `sameType` sets in topic order; with
//    `showOther`, then the other type's sets below them, in topic order; without it, none of them;
//  - `compactRows(window: PitWindow, showOther: boolean): CompactRow[]`, `CompactRow = { letter: string; lap: CellPart;
//    role: Role; bold: boolean }`: first the fitted set, its letter (kit `COMPOUND_MARK`) and its last lap `L31` (kit
//    `formatLapNumber(n, 2)`), empty with the reason while `stint.latest` is unknown, emphasis `lastLapEmphasis`; then
//    one row per visible set that reaches the flag (a set that does not has no window: no row), its window `L23–31`
//    (kit `formatLapRange`), a one-lap window one lap `L44`, emphasis `windowEmphasis(window)` for the window compound.
import { describe, expect, it } from 'vitest';
import { INTER, OPEN, OVER, EARLY, race } from './fixtures.ts';
import { compactRows, visibleSets } from './rows.ts';

const text = (rows: ReturnType<typeof compactRows>): string[] => rows.map((r) => `${r.letter} ${r.lap.text}`);

describe('visibleSets', () => {
  it('hides the other type\'s sets while otherType is off', () => {
    expect(visibleSets(INTER, false).map((s) => s.compound)).toEqual(['inter']);
  });

  it('shows the other type\'s sets below the same-type ones while otherType is on', () => {
    expect(visibleSets(INTER, true).map((s) => s.compound)).toEqual(['inter', 'medium']);
  });

  it('keeps every same-type set, also one that does not reach the flag (its life line ends short)', () => {
    expect(visibleSets(OPEN, false).map((s) => s.compound)).toEqual(['hard', 'soft']);
  });
});

describe('compactRows', () => {
  it('writes the mockup\'s rows: M L31, H L23–31 (S does not reach the flag: no row)', () => {
    expect(text(compactRows(OPEN, false))).toEqual(['M L31', 'H L23–31']);
  });

  it('makes the open window white bold and leaves the fitted set\'s last lap in the text colour', () => {
    expect(compactRows(OPEN, false).map((r) => [r.role, r.bold])).toEqual([['text', false], ['ownCar', true]]);
  });

  it('makes the last lap amber past the tyres\' life and the closed window faint', () => {
    const rows = compactRows(OVER, false);
    expect(text(rows)).toEqual(['M L31', 'H L23–31']);
    expect(rows.map((r) => [r.role, r.bold])).toEqual([['warning', true], ['textFaint', false]]);
  });

  it('writes a one-lap window as one lap', () => {
    const monaco = race({ flag: 78, now: 30, stint: { compound: 'medium', fromLap: 1, latest: 44 }, sets: [{ compound: 'hard', lifeLaps: 34 }] });
    expect(text(compactRows(monaco, false))).toEqual(['M L44', 'H L44']);
  });

  it('shows an unknown last lap empty with its reason', () => {
    const [fitted] = compactRows(EARLY, false);
    expect(fitted).toMatchObject({ letter: 'M', lap: { text: '', reason: 'insufficientData' } });
  });

  it('adds the other type\'s rows below only while otherType is on', () => {
    expect(text(compactRows(INTER, false))).toEqual(['I L30', 'I L27–30']);
    expect(text(compactRows(INTER, true))).toEqual(['I L30', 'I L27–30', 'M L24–30']);
  });
});
