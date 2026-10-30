// End-of-line labels of the chart (Task L; mockup docs/brainstorms/2026-10-29-sp3-displays/3-gap-chart.html): each line
// is named at its right end, and labels that end close together are pushed apart. Contract of the pure helpers in
// src/kit/chart/labels.ts:
//  - `endLabels(series, range)` returns one `{ index, text, value, bold }` per series that has a point with
//    `range[0] <= x <= range[1]`, in series order: `index` is the series' index in `series`, `text` its `label`,
//    `value` the y of its point with the largest x inside the range, `bold` true exactly when `colour.ownCar`;
//    series without a point in the range get no label (extra fields on a label are allowed);
//  - `placeLabels(ends, rowPx, heightPx)` takes each label's line end as a plot-relative pixel y (0 the top of the
//    plot, `heightPx` the bottom) and returns the label centres, in the same order:
//    - every centre lies in `[rowPx / 2, heightPx - rowPx / 2]` (a label never leaves the plot);
//    - the centres keep the order of the ends (a lower end never gets a higher label);
//    - when `ends.length * rowPx <= heightPx`, any two centres are at least `rowPx` apart;
//    - a label at least a few rows from every other one and inside the plot stays at its end;
//    - a label pushed apart moves by at most one row; the input is not mutated.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ChartSeries } from '../../src/kit/chart/data.ts';
import { endLabels, placeLabels } from '../../src/kit/chart/labels.ts';

const ROW = 13;
const HEIGHT = 300;
const EPS = 1e-9;
const plain = { colour: '#c13b43', dashed: false, ownCar: false };
const own = { colour: 'var(--pw-ownCar)', dashed: false, ownCar: true };

describe('endLabels', () => {
  it('gives one label per series with a point in the visible range, at its last visible value', () => {
    const series: ChartSeries[] = [
      { label: 'VER', points: [[1, -1], [2, -2], [3, -3]] },
      { label: 'NOR', points: [[1, -4], [2, -5]] },
    ];
    expect(endLabels(series, [1, 3])).toMatchObject([
      { index: 0, text: 'VER', value: -3 },
      { index: 1, text: 'NOR', value: -5 },
    ]);
  });

  it('ends a label at the last point inside the range, not at a point beyond it', () => {
    const series: ChartSeries[] = [{ label: 'VER', points: [[1, -1], [2, -2], [3, -3], [4, -4]] }];
    expect(endLabels(series, [1, 3])).toMatchObject([{ index: 0, text: 'VER', value: -3 }]);
  });

  it('gives no label to a series without a point in the visible range, and keeps the others\' indices', () => {
    const series: ChartSeries[] = [
      { label: 'OLD', points: [[1, -1], [2, -2]] },
      { label: 'NOW', points: [[1, -3], [6, -4]] },
      { label: 'NONE', points: [] },
    ];
    expect(endLabels(series, [5, 6])).toMatchObject([{ index: 1, text: 'NOW', value: -4 }]);
  });

  it('makes the label bold exactly for an own car', () => {
    const series: ChartSeries[] = [
      { label: 'KUH', points: [[1, 0]], colour: own },
      { label: 'LEC', points: [[1, 0]], colour: plain },
      { label: 'ref', points: [[1, 0]] },
    ];
    expect(endLabels(series, [0, 1]).map((l) => l.bold)).toEqual([true, false, false]);
  });
});

describe('placeLabels', () => {
  it('keeps a single label at its end', () => {
    expect(placeLabels([120], ROW, HEIGHT)).toEqual([120]);
  });

  it('keeps labels more than a row apart at their ends', () => {
    expect(placeLabels([40, 100, 200], ROW, HEIGHT)).toEqual([40, 100, 200]);
  });

  it('pushes two labels within one row apart to a full row, each by at most a row, in end order', () => {
    const ends = [104, 100];
    const [lower, upper] = placeLabels(ends, ROW, HEIGHT) as [number, number];
    expect(lower - upper).toBeGreaterThanOrEqual(ROW - EPS);
    expect(Math.abs(lower - 104)).toBeLessThanOrEqual(ROW + EPS);
    expect(Math.abs(upper - 100)).toBeLessThanOrEqual(ROW + EPS);
  });

  it('gives two lines that end on the same value a row each', () => {
    const [a, b] = placeLabels([150, 150], ROW, HEIGHT) as [number, number];
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(ROW - EPS);
  });

  it('leaves a far label at its end while pushing a close pair apart', () => {
    expect(placeLabels([100, 104, 250], ROW, HEIGHT)[2]).toBe(250);
  });

  it('keeps a label inside the plot when its line ends at the top or bottom edge', () => {
    const [top, bottom] = placeLabels([0, HEIGHT], ROW, HEIGHT) as [number, number];
    expect(top).toBeGreaterThanOrEqual(ROW / 2 - EPS);
    expect(bottom).toBeLessThanOrEqual(HEIGHT - ROW / 2 + EPS);
  });

  it('keeps a bunch at the bottom edge inside the plot, a row apart', () => {
    const out = placeLabels([HEIGHT, HEIGHT - 1, HEIGHT - 2, HEIGHT - 3], ROW, HEIGHT);
    const sorted = [...out].sort((a, b) => a - b);
    expect(sorted.at(-1)!).toBeLessThanOrEqual(HEIGHT - ROW / 2 + EPS);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(ROW - EPS);
  });

  it('does not mutate the ends and returns none for no labels', () => {
    const ends = [100, 101, 102];
    placeLabels(ends, ROW, HEIGHT);
    expect(ends).toEqual([100, 101, 102]);
    expect(placeLabels([], ROW, HEIGHT)).toEqual([]);
  });

  it('labels that fit are a row apart, inside the plot and in end order, for any ends', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: HEIGHT, noNaN: true }), { maxLength: Math.floor(HEIGHT / ROW) }), (ends) => {
        const out = placeLabels(ends, ROW, HEIGHT);
        expect(out).toHaveLength(ends.length);
        for (const y of out) {
          expect(y).toBeGreaterThanOrEqual(ROW / 2 - EPS);
          expect(y).toBeLessThanOrEqual(HEIGHT - ROW / 2 + EPS);
        }
        for (let i = 0; i < ends.length; i++) {
          for (let j = 0; j < ends.length; j++) {
            if (i === j) continue;
            expect(Math.abs(out[i]! - out[j]!)).toBeGreaterThanOrEqual(ROW - 1e-6);
            if (ends[i]! < ends[j]!) expect(out[i]!).toBeLessThan(out[j]!);
          }
        }
      }),
    );
  });

  it('labels that cannot all fit still stay inside the plot and keep end order', () => {
    const ends = [10, 20, 30, 40, 50, 60];
    const out = placeLabels(ends, ROW, 50);
    for (const y of out) {
      expect(y).toBeGreaterThanOrEqual(ROW / 2 - EPS);
      expect(y).toBeLessThanOrEqual(50 - ROW / 2 + EPS);
    }
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]! - EPS);
  });
});
