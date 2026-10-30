// The lines the chart hands uPlot (review RU1 and RU6, wave 2 T6). Contract of `plotLines(series)` in
// src/kit/chart/data.ts (pure):
//  - first every series in order without its live point (`of` its index, `live: false`), then one live line per series
//    in series order (`live: true`): the series' last settled point and its live point when `liveEnd` is true, else no
//    points at all;
//  - so the lines' `of` and `live` depend only on the number of series, never on which series are live: a car that
//    crosses the line (its live end goes) or leaves it (it comes back) changes the data only, never the plot's series;
//  - a live series with a single point (lap 1: no completed lap yet) has no settled points, and its live line is that point;
//  - `buildData` gives a line without points all nulls, so the plot draws nothing for it.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildData, plotLines, type ChartSeries } from '../../src/kit/chart/data.ts';

const pts = (k: number): Array<[number, number]> => [[1, k], [2, k + 1], [3, k + 2]];

describe('plotLines', () => {
  it('gives every series its settled line, then every series its live line: the segment to a live end, empty otherwise', () => {
    const series: ChartSeries[] = [
      { label: 'a', points: [...pts(10), [3.4, 12.5]], liveEnd: true },
      { label: 'b', points: pts(20) },
    ];
    expect(plotLines(series)).toEqual([
      { of: 0, live: false, points: pts(10) },
      { of: 1, live: false, points: pts(20) },
      { of: 0, live: true, points: [[3, 12], [3.4, 12.5]] },
      { of: 1, live: true, points: [] },
    ]);
  });

  it('keeps the same lines whichever series are live: only their points change', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), (a, b) => {
        const series = (live: boolean[]): ChartSeries[] => a.map((_, i) => ({ label: `s${i}`, points: [...pts(i), [3.5, i]], liveEnd: live[i] }));
        const shape = (live: boolean[]) => plotLines(series(live)).map((l) => [l.of, l.live]);
        expect(shape(a)).toEqual(shape(b));
        expect(shape(a)).toHaveLength(2 * a.length);
      }),
    );
  });

  it('a live series with one point (no completed lap yet) is only its live line, at that point', () => {
    expect(plotLines([{ label: 'a', points: [[0.4, -1.2]], liveEnd: true }])).toEqual([
      { of: 0, live: false, points: [] },
      { of: 0, live: true, points: [[0.4, -1.2]] },
    ]);
  });

  it('a series that is not live keeps all its points on its settled line', () => {
    const [settled] = plotLines([{ label: 'a', points: pts(1), liveEnd: false }]);
    expect(settled).toEqual({ of: 0, live: false, points: pts(1) });
  });

  it('gives uPlot all nulls for the live line of a series that is not live', () => {
    const data = buildData(plotLines([{ label: 'a', points: [...pts(10), [3.4, 12.5]], liveEnd: true }, { label: 'b', points: pts(20) }]));
    expect(data).toEqual([
      [1, 2, 3, 3.4],
      [10, 11, 12, null],
      [20, 21, 22, null],
      [null, null, 12, 12.5],
      [null, null, null, null],
    ]);
  });

  it('does not mutate the series', () => {
    const series: ChartSeries[] = [{ label: 'a', points: [...pts(1), [3.5, 4]], liveEnd: true }];
    const copy = structuredClone(series);
    plotLines(series);
    expect(series).toEqual(copy);
  });
});
