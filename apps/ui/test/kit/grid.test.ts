// The character-cell grid helper (spec 8.4; brainstorm "column grids with aligned decimals"). Contract assumed of `kit/grid/grid.ts`:
//   type GridColumn = { width: number; align?: 'left' | 'right' }     // align defaults to 'left'
//   fitCell(text, width, align = 'left'): string       // exactly `width` characters: padded on the left (right-aligned) or
//                                                      // on the right; a longer text is cut to `width - 1` characters plus '…'
//   gridRow(columns: GridColumn[], cells: string[], gap = 1): string   // cells fitted and joined by `gap` spaces;
//                                                      // fewer cells than columns: the rest is blank; width = gridWidth
//   gridWidth(columns: GridColumn[], gap = 1): number  // sum of widths + gap between neighbours
//   fixed(value: number, decimals: number): string     // `toFixed` with the true minus and -0 shown as 0 (`-0.04` at 1 decimal -> `0.0`)
import { describe, expect, it } from 'vitest';
import { fixed, fitCell, gridRow, gridWidth } from '../../src/kit/grid/grid.ts';
import { formatLapTime } from '../../src/kit/values/format.ts';

describe('fitCell', () => {
  it('pads left text on the right', () => expect(fitCell('KUH', 5)).toBe('KUH  '));
  it('pads right-aligned text on the left', () => expect(fitCell('1.8', 6, 'right')).toBe('   1.8'));
  it('an exact fit is unchanged', () => expect(fitCell('abcd', 4, 'right')).toBe('abcd'));
  it('a too long text is cut with an ellipsis, to the width', () => {
    expect(fitCell('abcdefgh', 5)).toBe('abcd…');
    expect(fitCell('abcdefgh', 5, 'right')).toBe('abcd…');
  });
  it('width 0 is empty', () => expect(fitCell('x', 0)).toBe(''));
});

describe('gridWidth and gridRow', () => {
  const columns = [{ width: 4 }, { width: 6, align: 'right' as const }, { width: 3, align: 'right' as const }];
  it('width is the columns plus the gaps', () => {
    expect(gridWidth(columns)).toBe(4 + 6 + 3 + 2);
    expect(gridWidth(columns, 2)).toBe(4 + 6 + 3 + 4);
    expect(gridWidth([])).toBe(0);
  });
  it('joins fitted cells with the gap', () => expect(gridRow(columns, ['FL', '1.8', '37'])).toBe('FL      1.8  37'));
  it('every row has the grid width, however short its cells', () => {
    for (const cells of [['FL', '1.8', '37'], ['RR'], [], ['VERY LONG NAME', '123456789', '12345']]) {
      expect(gridRow(columns, cells)).toHaveLength(gridWidth(columns));
    }
  });
  it('a custom gap', () => expect(gridRow([{ width: 2 }, { width: 2 }], ['a', 'b'], 3)).toBe('a    b '));
});

describe('fixed', () => {
  it.each([
    [1.8, 1, '1.8'],
    [12, 1, '12.0'],
    [1.625, 2, '1.63'],
    [0, 3, '0.000'],
    [-0.04, 1, '0.0'],
    [-1.25, 1, '−1.3'],
    [37, 0, '37'],
  ])('%f at %i decimals -> %s', (v, d, text) => expect(fixed(v, d)).toBe(text));
});

describe('alignment: the decimal point and the colon line up', () => {
  const numbers = gridRowsOf([[0.4], [12.34], [3.1], [-1.5], [100]].map(([n]) => fixed(n as number, 1)), 7);
  it('right-aligned numbers of one decimal count share the position of the point', () => {
    const at = numbers.map((r) => r.indexOf('.'));
    expect(new Set(at).size).toBe(1);
  });
  it('lap times share the position of the colon and the point', () => {
    const rows = gridRowsOf([71910, 83456, 605001, 59999].map(formatLapTime), 9);
    expect(new Set(rows.map((r) => r.indexOf(':'))).size).toBe(1);
    expect(new Set(rows.map((r) => r.indexOf('.'))).size).toBe(1);
  });
  it('a column of different decimals does not line up unless fixed (why the helper exists)', () => {
    const rows = gridRowsOf(['1.8', '12', '3.25'], 6);
    expect(new Set(rows.map((r) => r.indexOf('.'))).size).toBeGreaterThan(1);
  });
});

/** One right-aligned column of `width`, one row per text. */
function gridRowsOf(texts: string[], width: number): string[] {
  return texts.map((t) => gridRow([{ width, align: 'right' }], [t]));
}
