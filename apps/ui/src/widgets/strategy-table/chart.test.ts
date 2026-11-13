// The strategy chart's lines (SP4.3b spec §10; mockup strategy-table-b.html; Q10 B; C65, C68). Contract assumed of `chart.ts`:
//  - `chartLines(rows: McRow[], state: { highlight: number | null }, box: Box): Line[]`, one line per row in row order,
//    `Line = { points: [x, y][]; role: Role; widthPx: number; dotted: boolean; dots: boolean }`:
//    - no highlight: every line `textDim` at the theme's `chart.lineWidth`, no dots, not dotted; the committed row's line
//      always `ownCar` at `chart.lineWidth` (Q10 B);
//    - a highlighted row: `ownCar` at `chart.ownCarLineWidth` with its points (`dots`), dotted when another row is
//      committed; the rest of its tie group (`tie`, when the highlighted row is tied) `textDim`; the others `textFaint`;
//      the committed line stays `ownCar` at `chart.lineWidth`;
//    - points: one per place P1 … Pn of `positionPmf`, x increasing across the box, y inside it, one y scale shared by
//      every line (a larger chance is higher, i.e. a smaller y);
//  - `chartMarks(rows, state, box, currentPosition)`: `now`, the faint vertical (`textFaint`) at the x of place
//    `currentPosition`; `tick`, the highlighted row's E[pos] on the place axis (`ownCar`, x interpolated between the
//    places), null without a highlight.
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../theme/index.ts';
import { chartLines, chartMarks, type Box, type Line } from './chart.ts';
import { COMMITTED, NO_HIGHLIGHT, OUR_PLACE } from './fixtures.ts';

const BOX: Box = { width: 456, height: 176 };
const THIN = DEFAULT_THEME.chart.lineWidth;
const THICK = DEFAULT_THEME.chart.ownCarLineWidth;
const look = (l: Line) => ({ role: l.role, widthPx: l.widthPx, dotted: l.dotted, dots: l.dots });

describe('strategy-table chart', () => {
  it('no highlight: every line textDim, the committed one ownCar at normal width', () => {
    const plain = chartLines(NO_HIGHLIGHT.rows, { highlight: null }, BOX);
    expect(plain).toHaveLength(NO_HIGHLIGHT.rows.length);
    for (const l of plain) expect(look(l)).toEqual({ role: 'textDim', widthPx: THIN, dotted: false, dots: false });

    const k = COMMITTED.rows.findIndex((r) => r.committed);
    expect(k).toBeGreaterThanOrEqual(0);
    const lines = chartLines(COMMITTED.rows, { highlight: null }, BOX);
    lines.forEach((l, i) => {
      expect(look(l), `row ${i}`).toEqual({ role: i === k ? 'ownCar' : 'textDim', widthPx: THIN, dotted: false, dots: false });
    });
  });

  // Row 2's pure part (its component test is in StrategyTable.test.ts): the roles of a highlight, the points, the marks.
  it('a highlight: ownCar, thick, its points, dotted only beside a committed row; the rest of its tie group textDim, the others textFaint; the committed line stays ownCar thin', () => {
    const rows = NO_HIGHLIGHT.rows;
    expect(rows[0]!.tie).toBe(true);
    const lines = chartLines(rows, { highlight: 0 }, BOX);
    lines.forEach((l, i) => {
      const want = i === 0 ? { role: 'ownCar', widthPx: THICK, dotted: false, dots: true }
        : { role: rows[i]!.tie ? 'textDim' : 'textFaint', widthPx: THIN, dotted: false, dots: false };
      expect(look(l), `row ${i}`).toEqual(want);
    });

    const k = COMMITTED.rows.findIndex((r) => r.committed);
    const h = COMMITTED.rows.findIndex((r, i) => i !== k && !r.tie);
    const withPlan = chartLines(COMMITTED.rows, { highlight: h }, BOX);
    expect(look(withPlan[h]!)).toEqual({ role: 'ownCar', widthPx: THICK, dotted: true, dots: true });
    expect(look(withPlan[k]!)).toEqual({ role: 'ownCar', widthPx: THIN, dotted: false, dots: false });
    withPlan.forEach((l, i) => {
      if (i !== h && i !== k) expect(l.role, `row ${i}`).toBe('textFaint');
    });
  });

  it('points: one per place, x increasing inside the box, one y scale for every line (a larger chance higher)', () => {
    const rows = NO_HIGHLIGHT.rows;
    const lines = chartLines(rows, { highlight: null }, BOX);
    const all: { p: number; y: number }[] = [];
    lines.forEach((l, i) => {
      expect(l.points).toHaveLength(rows[i]!.positionPmf.length);
      for (let k = 0; k < l.points.length; k++) {
        const [x, y] = l.points[k]!;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(BOX.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(BOX.height);
        if (k > 0) expect(x).toBeGreaterThan(l.points[k - 1]![0]);
        expect(x).toBeCloseTo(lines[0]!.points[k]![0], 6);
        all.push({ p: rows[i]!.positionPmf[k]!, y });
      }
    });
    all.sort((a, b) => a.p - b.p);
    for (let k = 1; k < all.length; k++) expect(all[k]!.y).toBeLessThanOrEqual(all[k - 1]!.y + 1e-9);
  });

  it('marks: the faint vertical at our place now; the E[pos] tick of the highlighted row only', () => {
    const rows = NO_HIGHLIGHT.rows;
    const [line] = chartLines(rows, { highlight: null }, BOX);
    const xs = line!.points.map(([x]) => x);
    const none = chartMarks(rows, { highlight: null }, BOX, OUR_PLACE);
    expect(none.now.role).toBe('textFaint');
    expect(none.now.x).toBeCloseTo(xs[OUR_PLACE - 1]!, 6);
    expect(none.tick).toBeNull();

    const h = 3;
    const { tick } = chartMarks(rows, { highlight: h }, BOX, OUR_PLACE);
    expect(tick?.role).toBe('ownCar');
    expect(tick?.x).toBeCloseTo(xs[0]! + (rows[h]!.ePos - 1) * (xs[1]! - xs[0]!), 6);
  });
});
