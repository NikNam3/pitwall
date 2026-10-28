// The visible x-range of the chart (requirement 2: more width shows more history, in x units).
// Contract of `visibleXRange(xs, cols, kind, xPerCell)` in src/kit/chart/data.ts (pure):
//  - `xs` is the sorted x values of the data, `cols` the chart width in cells, `kind` 'lap' | 'sessionTime',
//    `xPerCell` the theme chart token `{ lap: number; sessionTime: number }` (injected here);
//  - returns `[max(xs) - cols * xPerCell[kind], max(xs)]`: the newest end is kept, the span is proportional to cols,
//    independent of how many points there are and of how they are spaced; no clamping to the data's oldest x;
//  - empty `xs` does not throw and returns `[0, cols * xPerCell[kind]]`.
import { describe, expect, it } from 'vitest';
import { visibleXRange } from '../../src/kit/chart/data.ts';

const xPerCell = { lap: 0.5, sessionTime: 2000 };
const span = (r: [number, number]) => r[1] - r[0];

describe('visibleXRange', () => {
  it('keeps the newest end', () => {
    expect(visibleXRange([1, 2, 3, 10], 20, 'lap', xPerCell)[1]).toBe(10);
  });

  it('span is cols x xPerCell of the kind', () => {
    expect(span(visibleXRange([1, 2, 3, 40], 20, 'lap', xPerCell))).toBe(10);
    expect(span(visibleXRange([0, 60000, 120000], 20, 'sessionTime', xPerCell))).toBe(40000);
  });

  it('twice the cols shows twice the x-span', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const narrow = visibleXRange(xs, 20, 'lap', xPerCell);
    const wide = visibleXRange(xs, 40, 'lap', xPerCell);
    expect(span(wide)).toBe(2 * span(narrow));
    expect(wide[1]).toBe(narrow[1]);
  });

  it('is time-proportional: irregular sample spacing does not change the span', () => {
    const even = visibleXRange([0, 1000, 2000, 3000], 10, 'sessionTime', xPerCell);
    const irregular = visibleXRange([0, 100, 150, 3000], 10, 'sessionTime', xPerCell);
    expect(span(even)).toBe(span(irregular));
  });

  it('handles an empty series', () => {
    expect(visibleXRange([], 20, 'lap', xPerCell)).toEqual([0, 10]);
  });
});
