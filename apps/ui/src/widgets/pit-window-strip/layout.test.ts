// The pit-window strip's label layout (SP4.2 spec §4 "Pit-window label layout", §6.2; the rules of
// docs/design/2026-11-07-sp4.2/gen.mjs `layoutRow` and `chartSvg`). The layout places, it computes no value (C65).
// Contract assumed of `layout.ts`:
//  - `layoutStrip(input: { cols: number; window: PitWindow; showOther: boolean }, cell: { w: number; h: number }):
//    StripLayout`, `StripLayout = { bars: Bar[]; lines: Line[]; labels: Label[] }`, in px of a panel `cols × cell.w` wide;
//  - `Label = { row; x; anchor: 'start' | 'middle' | 'end'; text; role; bold; box: { l; r } }`: `box` is the label's
//    extent in its row, `[...text].length × cell.w` wide, at `x` by its anchor;
//  - `Bar` carries at least `{ row: number; box: { l: number; r: number } }`: every solid or hollow bar of a row (the
//    fitted set's done laps and the rest of its life, its amber overrun, a window's band);
//  - rows: 0 the fitted set, then one per visible set (`visibleSets`: same type, then with `showOther` the other type),
//    then the axis row;
//  - a window's two laps go left and right of its band, else together (`L23–31`) on the right, else on the left; a
//    one-lap window writes one lap; the fitted set's last lap goes right of its bar end; the axis places now, then the
//    flag, then a faint lap every 10, dropping a label that would come within one cell of a placed one.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PitWindow, VisualCompound } from '@pitwall/domain';
import { CELL, INTER, OPEN, race, type SetSpec } from './fixtures.ts';
import { layoutStrip } from './layout.ts';

type Layout = ReturnType<typeof layoutStrip>;
type Lbl = Layout['labels'][number];
const EPS = 1e-6;

const inRow = (l: Layout, row: number): Lbl[] => l.labels.filter((x) => x.row === row);
const texts = (labels: Lbl[]): string[] => labels.map((x) => x.text);
const barsOf = (l: Layout, row: number) => l.bars.filter((b) => b.row === row);
const axisRow = (l: Layout): number => Math.max(...l.labels.map((x) => x.row));
const full = (window: PitWindow, showOther = false, cols = 46): Layout => layoutStrip({ cols, window, showOther }, CELL);

describe('layoutStrip: the mockup L23 case (Silverstone 52 laps, M to L31, H window L23–31, S short)', () => {
  const l = full(OPEN);

  it('writes the fitted set\'s last lap L31 right of its bar end, in the text colour', () => {
    const [fitted, ...more] = inRow(l, 0);
    expect(more).toEqual([]);
    expect(fitted).toMatchObject({ text: 'L31', anchor: 'start', role: 'text', bold: false });
    const barEnd = Math.max(...barsOf(l, 0).map((b) => b.box.r));
    expect(fitted!.box.l).toBeGreaterThan(barEnd);
  });

  it('writes the H window\'s laps L23 left and L31 right of its band, white bold (open now)', () => {
    const labels = inRow(l, 1);
    expect(labels.map((x) => [x.text, x.anchor, x.role, x.bold])).toEqual([
      ['L23', 'end', 'ownCar', true],
      ['L31', 'start', 'ownCar', true],
    ]);
    const band = barsOf(l, 1);
    expect(labels[0]!.box.r).toBeLessThan(Math.min(...band.map((b) => b.box.l)));
    expect(labels[1]!.box.l).toBeGreaterThan(Math.max(...band.map((b) => b.box.r)));
  });

  it('writes no lap for S, which does not reach the flag (no window)', () => {
    expect(inRow(l, 2)).toEqual([]);
  });

  it('places the axis: now L23 white bold, the flag L52 dim, the faint L10', () => {
    expect(axisRow(l)).toBe(3);
    const axis = inRow(l, 3);
    expect(texts(axis)).toEqual(expect.arrayContaining(['L23', 'L52', 'L10']));
    expect(axis.find((x) => x.text === 'L23')).toMatchObject({ role: 'ownCar', bold: true });
    expect(axis.find((x) => x.text === 'L52')).toMatchObject({ role: 'textDim', bold: false });
    expect(axis.find((x) => x.text === 'L10')).toMatchObject({ role: 'textFaint', bold: false });
  });
});

describe('layoutStrip: the rules', () => {
  it('writes one label for a one-lap window', () => {
    const monaco = race({ flag: 78, now: 30, stint: { compound: 'medium', fromLap: 1, latest: 44 }, sets: [{ compound: 'hard', lifeLaps: 34 }] });
    expect(texts(inRow(full(monaco), 1))).toEqual(['L44']);
  });

  it('writes both laps together on the right when the window has no room on its left', () => {
    // a window from L01: its band starts at the axis' left edge
    const w = race({ flag: 52, now: 10, stint: { compound: 'soft', fromLap: 1, latest: 24 }, sets: [{ compound: 'hard', lifeLaps: 60 }] });
    const l = full(w);
    const [label, ...more] = inRow(l, 1);
    expect(more).toEqual([]);
    expect(label).toMatchObject({ text: 'L01–24', anchor: 'start' });
    expect(label!.box.l).toBeGreaterThan(Math.max(...barsOf(l, 1).map((b) => b.box.r)));
  });

  it('drops the flag label at now L50 of 52 and keeps now', () => {
    const w = race({ flag: 52, now: 50, stint: { compound: 'hard', fromLap: 30, latest: 51 }, sets: [] });
    const l = full(w);
    const axis = texts(inRow(l, axisRow(l)));
    expect(axis).toContain('L50');
    expect(axis).not.toContain('L52');
  });

  it('shows the other type\'s rows below the same-type ones only while otherType is on', () => {
    const off = full(INTER, false);
    expect(axisRow(off)).toBe(2);
    expect(texts(inRow(off, 1))).toEqual(['L27', 'L30']);
    const on = full(INTER, true);
    expect(axisRow(on)).toBe(3);
    expect(texts(inRow(on, 1))).toEqual(['L27', 'L30']);
    expect(texts(inRow(on, 2))).toEqual(['L24', 'L30']);
  });
});

// ---------------------------------------------------------------- property (spec §6.2)
const COMPOUNDS: VisualCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

/** A random race: flag 5–78, now 1…flag, a stint from 1…now, its latest stop lap from the stint start to flag − 1,
 *  up to 4 sets with one-lap windows, windows ending at flag − 1, sets not reaching the flag and the other type. */
const arbRace = fc
  .record({ flag: fc.integer({ min: 5, max: 78 }), nowF: fc.double({ min: 0, max: 1, noNaN: true }), fromF: fc.double({ min: 0, max: 1, noNaN: true }), latestF: fc.double({ min: 0, max: 1, noNaN: true }) })
  .chain(({ flag, nowF, fromF, latestF }) => {
    const now = 1 + Math.min(flag - 1, Math.floor(nowF * flag));
    const fromLap = 1 + Math.min(Math.min(now, flag - 1) - 1, Math.floor(fromF * Math.min(now, flag - 1)));
    const latest = fromLap + Math.min(flag - 1 - fromLap, Math.floor(latestF * (flag - fromLap)));
    const arbSet = fc.record({
      // life: a one-lap window (earliest = latest), any life (also short of the flag), a window from the stint start
      lifeLaps: fc.oneof(fc.constant(flag - latest), fc.integer({ min: 1, max: 90 }), fc.constant(flag - fromLap + 5)),
      sameType: fc.boolean(),
    });
    return fc.record({
      flag: fc.constant(flag), now: fc.constant(now), fromLap: fc.constant(fromLap),
      latest: fc.oneof({ weight: 9, arbitrary: fc.constant<number | 'insufficientData'>(latest) }, { weight: 1, arbitrary: fc.constant<number | 'insufficientData'>('insufficientData') }),
      fitted: fc.constantFrom(...COMPOUNDS),
      sets: fc.uniqueArray(fc.tuple(fc.constantFrom(...COMPOUNDS), arbSet), { maxLength: 4, selector: ([c]) => c }),
      cols: fc.integer({ min: 46, max: 90 }),
      showOther: fc.boolean(),
    });
  })
  .map((r) => ({
    cols: r.cols,
    showOther: r.showOther,
    window: race({
      flag: r.flag, now: r.now, stint: { compound: r.fitted, fromLap: r.fromLap, latest: r.latest },
      sets: r.sets.map(([compound, s]): SetSpec => ({ compound, lifeLaps: Math.max(1, s.lifeLaps), sameType: s.sameType })),
    }),
  }));

describe('layoutStrip: property over random races', () => {
  it('keeps every label a cell from every other one in its row, off the bars of its row, and inside the panel', () => {
    fc.assert(
      fc.property(arbRace, ({ cols, window, showOther }) => {
        const l = layoutStrip({ cols, window, showOther }, CELL);
        const width = cols * CELL.w;
        for (const a of l.labels) {
          // honest boxes: the text's width, at x by its anchor
          expect(a.box.r - a.box.l).toBeCloseTo([...a.text].length * CELL.w, 6);
          const at = a.anchor === 'start' ? a.box.l : a.anchor === 'end' ? a.box.r : (a.box.l + a.box.r) / 2;
          expect(at).toBeCloseTo(a.x, 6);
          // inside the panel
          expect(a.box.l).toBeGreaterThanOrEqual(-EPS);
          expect(a.box.r).toBeLessThanOrEqual(width + EPS);
          // never on a bar of its row
          for (const b of l.bars.filter((x) => x.row === a.row)) expect(a.box.r <= b.box.l + EPS || a.box.l >= b.box.r - EPS).toBe(true);
          // no two labels within one cell
          for (const c of l.labels) {
            if (c === a || c.row !== a.row) continue;
            expect(a.box.r + CELL.w <= c.box.l + EPS || c.box.r + CELL.w <= a.box.l + EPS).toBe(true);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
