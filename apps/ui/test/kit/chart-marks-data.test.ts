// The kit chart's ranges for marks, pinned marks, sd bands and the tyre-age x axis (task 13k, ruling R27; the stint
// scatter, mockup docs/design/2026-11-06-sp4.1a/source-badge.html). The display passes values as the analysis gives
// them and does no arithmetic (C65): the chart computes the band's outline and the ranges. Contract of
// src/kit/chart/data.ts (pure), additive to the existing API:
//  - `ChartMark = { x: number; y: number; shape: 'dot' | 'ring' | 'dottedRing'; role: Role; pinned?: boolean }`;
//  - `BandPoint = { x: number; y: number; sd: number }`; `ChartSeries.band?: readonly BandPoint[]` is the ±sd band
//    around the series' line (usually the line's own points with their sd);
//  - `yExtent(series, marks): [number, number] | undefined`: the y values the plot must show: every series point's y,
//    every band point's y - sd and y + sd, every mark's y that is not pinned. A pinned mark never widens it; only when
//    nothing else has a y is it the pinned marks' extent; nothing at all is `undefined`;
//  - `bandOutline(band): Array<[x, y]>`: the band as one polygon, its upper edge (y + sd) in x order, then its lower
//    edge (y - sd) back; fewer than two points have no area and give `[]`;
//  - `visibleXRange(xs, cols, 'tyreAge', xPerCell)`: a tyre-age axis shows the whole stint whatever the width: from 0
//    (a new tyre) to the largest x plus one lap (the next lap's room: ages 1 to 23 on a 0 to 24 axis); no x is `[0, 1]`.
import { describe, expect, it } from 'vitest';
import { bandOutline, visibleXRange, yExtent, type BandPoint, type ChartMark, type ChartSeries } from '../../src/kit/chart/data.ts';

const mark = (x: number, y: number, over: Partial<ChartMark> = {}): ChartMark => ({ x, y, shape: 'dot', role: 'ownCar', ...over });
const xPerCell = { lap: 0.5, sessionTime: 2000 };

describe('yExtent', () => {
  it('spans the y of every series point', () => {
    const series: ChartSeries[] = [{ label: 'a', points: [[1, 5], [2, 9]] }, { label: 'b', points: [[1, 3]] }];
    expect(yExtent(series, [])).toEqual([3, 9]);
  });

  it('spans a band from y - sd to y + sd', () => {
    const band: BandPoint[] = [{ x: 1, y: 10, sd: 2 }, { x: 2, y: 12, sd: 3 }];
    expect(yExtent([{ label: 'fit', points: [[1, 10], [2, 12]], band }], [])).toEqual([8, 15]);
  });

  it('spans every mark that is not pinned, of every shape', () => {
    const series: ChartSeries[] = [{ label: 'a', points: [[1, 10], [2, 12]] }];
    const marks = [mark(1, 20), mark(2, 1, { shape: 'ring', role: 'textFaint', pinned: false }), mark(3, 11, { shape: 'dottedRing' })];
    expect(yExtent(series, marks)).toEqual([1, 20]);
  });

  it('is not widened by a pinned mark above or below', () => {
    const series: ChartSeries[] = [{ label: 'a', points: [[1, 91_000], [2, 91_400]] }];
    const marks = [mark(1, 91_200), mark(5, 104_000, { shape: 'ring', role: 'textFaint', pinned: true }), mark(6, 80_000, { shape: 'ring', role: 'textFaint', pinned: true })];
    expect(yExtent(series, marks)).toEqual([91_000, 91_400]);
  });

  it('spans the marks alone when there is no series (an unknown fit still shows its laps)', () => {
    expect(yExtent([], [mark(1, 91_500), mark(2, 91_100), mark(3, 99_000, { shape: 'ring', pinned: true })])).toEqual([91_100, 91_500]);
  });

  it('spans the pinned marks only when nothing else has a y', () => {
    const pinned = [mark(1, 93_800, { shape: 'ring', pinned: true }), mark(2, 104_000, { shape: 'ring', pinned: true })];
    expect(yExtent([{ label: 'empty', points: [] }], pinned)).toEqual([93_800, 104_000]);
  });

  it('is undefined with nothing to show', () => {
    expect(yExtent([], [])).toBeUndefined();
    expect(yExtent([{ label: 'empty', points: [] }], [])).toBeUndefined();
  });

  it('does not mutate its inputs', () => {
    const series: ChartSeries[] = [{ label: 'a', points: [[2, 4], [1, 3]], band: [{ x: 2, y: 4, sd: 1 }, { x: 1, y: 3, sd: 1 }] }];
    const marks = [mark(3, 9), mark(1, 1, { pinned: true })];
    const copies = structuredClone([series, marks]);
    yExtent(series, marks);
    expect([series, marks]).toEqual(copies);
  });
});

describe('bandOutline', () => {
  it('is the upper edge in x order, then the lower edge back', () => {
    const band: BandPoint[] = [{ x: 1, y: 10, sd: 2 }, { x: 2, y: 12, sd: 3 }, { x: 3, y: 13, sd: 1 }];
    expect(bandOutline(band)).toEqual([[1, 12], [2, 15], [3, 14], [3, 12], [2, 9], [1, 8]]);
  });

  it('has no area with fewer than two points', () => {
    expect(bandOutline([])).toEqual([]);
    expect(bandOutline([{ x: 1, y: 10, sd: 2 }])).toEqual([]);
  });

  it('does not mutate the band', () => {
    const band: BandPoint[] = [{ x: 1, y: 10, sd: 2 }, { x: 2, y: 12, sd: 3 }];
    const copy = structuredClone(band);
    bandOutline(band);
    expect(band).toEqual(copy);
  });
});

describe("visibleXRange: the tyre-age axis", () => {
  const ages = Array.from({ length: 23 }, (_, i) => i + 1);

  it('shows the whole stint from a new tyre to one lap past the oldest age', () => {
    expect(visibleXRange(ages, 72, 'tyreAge', xPerCell)).toEqual([0, 24]);
  });

  it('shows the whole stint whatever the width', () => {
    expect(visibleXRange(ages, 10, 'tyreAge', xPerCell)).toEqual([0, 24]);
    expect(visibleXRange(ages, 300, 'tyreAge', xPerCell)).toEqual([0, 24]);
  });

  it('starts at 0 even when the first age is later', () => {
    expect(visibleXRange([5, 6, 9], 36, 'tyreAge', xPerCell)).toEqual([0, 10]);
  });

  it('is [0, 1] without data or with only a new tyre', () => {
    expect(visibleXRange([], 36, 'tyreAge', xPerCell)).toEqual([0, 1]);
    expect(visibleXRange([0], 36, 'tyreAge', xPerCell)).toEqual([0, 1]);
  });

  it('leaves the lap and session-time ranges as they are', () => {
    expect(visibleXRange([0, 1, 2, 40], 20, 'lap', xPerCell)).toEqual([30, 40]);
    expect(visibleXRange([0, 60_000, 120_000], 20, 'sessionTime', xPerCell)).toEqual([80_000, 120_000]);
  });
});
