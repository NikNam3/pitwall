// The visible x-range of the chart (requirement 2: more width shows more history, in x units).
// Contract of `visibleXRange(xs, cols, kind, xPerCell)` in src/kit/chart/data.ts (pure):
//  - `xs` is the sorted x values of the data, `cols` the chart width in cells, `kind` 'lap' | 'sessionTime',
//    `xPerCell` the theme chart token `{ lap: number; sessionTime: number }` (injected here);
//  - `span = cols * xPerCell[kind]`, `end = max(xs)`, `start = max(min(xs), end - span)`; returns `[start, end]`;
//  - with enough history the span is exactly `span` (more width shows more history, independent of point spacing);
//  - with less history than the width the range is `[min(xs), max(xs)]`: the axis starts at the first data point
//    (never at negative laps) and the chart is stretched to the width (Q3);
//  - a single point (min = max) returns `[max(0, end - span), end]`, or `[end, end + span]` when that would be
//    degenerate (end = 0), so the range is never degenerate and never negative;
//  - empty `xs` does not throw and returns `[0, span]`.
import { describe, expect, it } from 'vitest';
import { visibleXRange } from '../../src/kit/chart/data.ts';

const xPerCell = { lap: 0.5, sessionTime: 2000 };
const span = (r: [number, number]) => r[1] - r[0];

describe('visibleXRange', () => {
  it('keeps the newest end', () => {
    expect(visibleXRange([1, 2, 3, 10], 20, 'lap', xPerCell)[1]).toBe(10);
  });

  it('span is cols x xPerCell of the kind', () => {
    expect(span(visibleXRange([0, 1, 2, 40], 20, 'lap', xPerCell))).toBe(10);
    expect(span(visibleXRange([0, 60000, 120000], 20, 'sessionTime', xPerCell))).toBe(40000);
  });

  it('twice the cols shows twice the x-span', () => {
    const xs = Array.from({ length: 101 }, (_, i) => i);
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

  it('less history than the width starts at the first data point', () => {
    expect(visibleXRange([1, 2, 3, 4, 5], 40, 'lap', xPerCell)).toEqual([1, 5]);
    expect(visibleXRange([30000, 90000], 40, 'sessionTime', xPerCell)).toEqual([30000, 90000]);
  });

  it('never starts before lap 0 or the first point', () => {
    for (const xs of [[0, 1, 2], [2, 3, 4, 5], [0, 12, 30]]) {
      const [start, end] = visibleXRange(xs, 40, 'lap', xPerCell);
      expect(start).toBeGreaterThanOrEqual(Math.max(0, Math.min(...xs)));
      expect(end).toBe(Math.max(...xs));
    }
  });

  it('a single point gives a non-degenerate, non-negative range', () => {
    expect(visibleXRange([7], 20, 'lap', xPerCell)).toEqual([0, 7]);
    expect(visibleXRange([0], 20, 'lap', xPerCell)).toEqual([0, 10]);
  });

  it('handles an empty series', () => {
    expect(visibleXRange([], 20, 'lap', xPerCell)).toEqual([0, 10]);
  });
});
