// @vitest-environment jsdom
// The chart (spec 5, brainstorm 7). uPlot is replaced by a fake constructor `new uPlot(opts, data, target)` that records
// `opts`, `data` and `target` in `instances`, and has `setSize(size)`, `setData(data)` and `destroy()` that record their calls.
// Contract the tests assume of Chart.svelte:
//  - `data[0]` is the x values and `data[i + 1]` the y values of `series[i]` (union of x's is not required: each series
//    is given its own points, so the test uses series that share x values); after the n series' lines come their n
//    live lines (`plotLines`, wave 2 T6): `data[n + i + 1]` and `opts.series[n + i + 1]` are `series[i]`'s live segment,
//    all nulls when it has no live end, so the plot's series never depend on which series are live;
//  - a live line strokes like its series (colour, width, alpha) with the theme's live dash `--pw-chart-live-dash`
//    (numbers, px on and px off) as its `dash`; a solid series has no dash;
//  - colours are resolved at construction time from the document root's `--pw-*` variables (uPlot cannot use `var()`);
//  - `opts.series[0]` is the x series; `opts.series[i + 1]` belongs to `series[i]`;
//  - `opts.width` / `opts.height` are `size.px`; a size change calls `setSize({ width, height })` (or rebuilds);
//  - a series with `colour` strokes with `colour.colour` as given (a `var(--pw-ownCar)` reference is resolved), `dash`
//    is set (non-empty array) when `colour.dashed`, and `width` is 3 for an own car and 1.5 otherwise, whatever the
//    chart's width (nothing scales with the panel);
//  - a series without `colour` strokes `series1`, `series2`, ... in order of those without colour;
//  - a series with `fresh === false` has `alpha` 0.35, all others `alpha` 1;
//  - `opts.axes[0]` is x and `opts.axes[1]` is y: their labels are drawn from xLabel / yLabel (`AxisLabel`, the label's
//    forms: kit/chart/labels.ts `fitAxisLabel`, review 7 R7-9); `label` is a function uPlot calls at draw time as
//    `label(u, axisIndex)`, after it has set the axis' label font on `u.ctx` (`labelFont`, its px size rounded at the pixel
//    ratio: uPlot's `pxRatioFont`); it reads `u.bbox` (canvas px) and measures each form with `u.ctx.measureText` (review 8,
//    R8-3: the exact width, no estimate of the font); `grid.stroke` and `ticks.stroke` the resolved
//    `grid` colour, `stroke` the resolved `textDim`, `font` and `labelFont` contain `<--pw-font-px>px` and the `--pw-font` family;
//  - `opts.scales.x.time === false` for both x kinds;
//  - `opts.hooks.drawClear` holds a function that paints the bands behind the series: for each band
//    `ctx.fillRect(u.valToPos(from, 'x', true), u.bbox.top, u.valToPos(to, 'x', true) - u.valToPos(from, 'x', true), u.bbox.height)`
//    with `ctx.fillStyle` the resolved `bgBand` when it is called, for `sc` and `vsc` alike; the plot background is `bg`
//    (painted with fillRect over the whole bbox first, or by the container's inline `background-color: var(--pw-bg)`).
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetSize } from '../../src/kit/types.ts';

type Fake = { opts: any; data: any; target: HTMLElement; setSize: ReturnType<typeof vi.fn>; setData: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
const { instances } = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('uplot', () => ({
  default: class {
    static pxRatio = 1;
    opts: unknown;
    data: unknown;
    target: unknown;
    setSize = vi.fn();
    setData = vi.fn();
    destroy = vi.fn();
    constructor(opts: unknown, data: unknown, target: unknown) {
      this.opts = opts;
      this.data = data;
      this.target = target;
      instances.push(this);
    }
  },
}));

import uPlot from 'uplot';
import Chart from '../../src/kit/chart/Chart.svelte';
import { carColour } from '../../src/theme/index.ts';

const VARS: Record<string, string> = {
  '--pw-bg': '#000001', '--pw-bgBand': '#141416', '--pw-grid': '#1c1d21', '--pw-textDim': '#8d9199',
  '--pw-ownCar': '#ffffff',
  '--pw-series1': '#a10001', '--pw-series2': '#a20002', '--pw-series3': '#a30003',
  '--pw-series4': '#a40004', '--pw-series5': '#a50005', '--pw-series6': '#a60006',
  '--pw-font': '"JetBrains Mono", monospace', '--pw-font-px': '13px',
  '--pw-chart-live-dash': '2 5',
};
const LIVE_DASH = [2, 5];
const size = (width: number): WidgetSize => ({ mode: 'full', cols: Math.floor(width / 8), rows: 20, px: { width, height: 300 }, dpr: 1 });
const pts = (k: number): Array<[number, number]> => [[1, k], [2, k + 1], [3, k + 2]];
const last = (): Fake => instances[instances.length - 1];

beforeEach(() => {
  instances.length = 0;
  for (const [k, v] of Object.entries(VARS)) document.documentElement.style.setProperty(k, v);
});
afterEach(() => {
  cleanup();
  for (const k of Object.keys(VARS)) document.documentElement.style.removeProperty(k);
});

const base = { xLabel: ['Lap'] as const, yLabel: ['Gap (s)'] as const, x: { kind: 'lap' as const }, size: size(400) };

type Box = { left: number; top: number; width: number; height: number };
type LabelContext = { font: string; measureText(text: string): { width: number } };
const FONT_PX = /(\d+(?:\.\d+)?)px/;
/**
 * The context as uPlot hands it to a label function: the axis' label font set, its px size rounded at `ratio` (uPlot's
 * `pxRatioFont`); `measureText` measures a font whose glyphs are `advance` em wide (0.6: the UI's monospace font).
 */
const labelContext = (index: number, ratio: number, advance = 0.6): LabelContext => {
  const font = String(last().opts.axes[index].labelFont).replace(FONT_PX, (_m, px: string) => `${Math.round(Number(px) * ratio)}px`);
  const px = Number(FONT_PX.exec(font)?.[1]);
  return { font, measureText: (text) => ({ width: text.length * advance * px }) };
};
/** What uPlot draws as `axes[index]`'s label on a plot of `bbox` (canvas px): what its label function returns for it. */
const drawnLabel = (index: number, bbox: Box, ctx: LabelContext = labelContext(index, 1)): string => {
  const label: unknown = last().opts.axes[index].label;
  return typeof label === 'function' ? String(label({ bbox, ctx }, index)) : String(label);
};
/** A plot that leaves the axes plenty of room in a 400 x 300 chart. */
const ROOMY: Box = { left: 60, top: 10, width: 300, height: 200 };

describe('Chart: series', () => {
  it('hands uPlot the --pw-series1... values for series without a colour, in order', () => {
    render(Chart, { ...base, series: [1, 2, 3, 4, 5, 6].map((k) => ({ label: `s${k}`, points: pts(k) })) });
    const s = last().opts.series;
    expect(s).toHaveLength(13);
    expect(s.slice(1, 7).map((x: any) => x.stroke)).toEqual(['#a10001', '#a20002', '#a30003', '#a40004', '#a50005', '#a60006']);
    expect(s.slice(1, 7).map((x: any) => x.label)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });

  it('gives uPlot x values first and each series y values', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(10) }, { label: 'b', points: pts(20) }] });
    expect(last().data).toEqual([[1, 2, 3], [10, 11, 12], [20, 21, 22], [null, null, null], [null, null, null]]);
  });

  it('uses a given car colour (resolved), dashes the teammate and draws own cars thicker', () => {
    const field = [
      { id: 0 as never, teamId: 0, raceNumber: 44 },
      { id: 1 as never, teamId: 0, raceNumber: 63 },
      { id: 2 as never, teamId: 1, raceNumber: 16 },
    ];
    const own = new Set([field[0]!.id, field[1]!.id]);
    const [a, b, c] = field.map((f) => carColour(f, field, own));
    render(Chart, {
      ...base,
      series: [
        { label: 'player', points: pts(1), colour: a },
        { label: 'mate', points: pts(2), colour: b },
        { label: 'rival', points: pts(3), colour: c },
        { label: 'plain', points: pts(4) },
      ],
    });
    const [, p, m, r, plain] = last().opts.series;
    expect(p.stroke).toBe('#ffffff');
    expect(m.stroke).toBe('#ffffff');
    expect(r.stroke).toBe('#c13b43');
    expect(p.dash ?? []).toHaveLength(0);
    expect(m.dash.length).toBeGreaterThan(0);
    expect(p.width).toBe(3);
    expect(m.width).toBe(3);
    expect(r.width).toBe(1.5);
    expect(plain.stroke).toBe('#a10001'); // first series without colour takes series1, not series4
  });

  it('dims a series whose fresh is false and no other', () => {
    render(Chart, {
      ...base,
      series: [{ label: 'a', points: pts(1), fresh: false }, { label: 'b', points: pts(2), fresh: true }, { label: 'c', points: pts(3) }],
    });
    expect(last().opts.series.slice(1, 4).map((s: any) => s.alpha)).toEqual([0.35, 1, 1]);
  });
});

describe('Chart: the live segment', () => {
  const own = { colour: '#c13b43', dashed: false, ownCar: true };
  const mate = { colour: '#c13b43', dashed: true, ownCar: false };
  const liveSeries = () => [
    { label: 'a', points: [...pts(1), [3.5, 3.4]] as Array<[number, number]>, liveEnd: true, colour: own },
    { label: 'b', points: pts(2), fresh: false },
    { label: 'c', points: [...pts(3), [3.4, 5.2]] as Array<[number, number]>, liveEnd: true, colour: mate },
  ];

  it("draws each series' live line after the series, in its look with the theme's live dash", () => {
    render(Chart, { ...base, series: liveSeries() });
    const s = last().opts.series;
    expect(s).toHaveLength(7);
    const [solid, live] = [s.slice(1, 4), s.slice(4, 7)];
    live.forEach((l: any, i: number) => {
      expect(l.stroke, `live ${i}`).toBe(solid[i].stroke);
      expect(l.width, `live ${i}`).toBe(solid[i].width);
      expect(l.alpha, `live ${i}`).toBe(solid[i].alpha);
      expect(l.dash, `live ${i}`).toEqual(LIVE_DASH);
    });
    expect(solid[0].dash ?? []).toHaveLength(0);
  });

  it('hands uPlot the live segments after the settled points, all nulls for a series without a live end', () => {
    render(Chart, { ...base, series: liveSeries() });
    expect(last().data).toEqual([
      [1, 2, 3, 3.4, 3.5],
      [1, 2, 3, null, null],
      [2, 3, 4, null, null],
      [3, 4, 5, null, null],
      [null, null, 3, null, 3.4],
      [null, null, null, null, null],
      [null, null, 5, 5.2, null],
    ]);
  });

  it('a live end that comes or goes updates the same plot: no new constructor call, no destroy', async () => {
    const { rerender } = render(Chart, { ...base, series: liveSeries() });
    const first = last();
    const count = instances.length;
    // car a crosses the line (its live end goes), car b leaves it (a live end comes)
    const next = [
      { label: 'a', points: [...pts(1), [4, 3.5]] as Array<[number, number]>, colour: own },
      { label: 'b', points: [...pts(2), [3.1, 4.1]] as Array<[number, number]>, fresh: false, liveEnd: true },
      liveSeries()[2]!,
    ];
    await rerender({ ...base, series: next });
    expect(instances.length).toBe(count);
    expect(first.destroy).not.toHaveBeenCalled();
    expect(first.setData.mock.calls.at(-1)![0]).toEqual([
      [1, 2, 3, 3.1, 3.4, 4],
      [1, 2, 3, null, null, 3.5],
      [2, 3, 4, null, null, null],
      [3, 4, 5, null, null, null],
      [null, null, null, null, null, null],
      [null, null, 4, 4.1, null, null],
      [null, null, 5, null, 5.2, null],
    ]);
  });
});

// A line of one point has no segment to draw (review 2, F4): at the end of lap 1 each car's line is one settled point
// until its next crossing, so every line of one point, settled or live, shows as a dot of its stroke.
// A chart reads its tokens where it is drawn, not on the document root (W3-A implement finding): a gallery cell or a
// panel with another theme sets the variables on a wrapper, and the chart inside draws with that theme's values.
describe('Chart: the theme of its own element', () => {
  it("draws with the line widths and dashes set on an ancestor, not the root's", () => {
    const wrapper = document.createElement('div');
    const tokens = { '--pw-chart-live-dash': '7 3', '--pw-chart-dash': '6 2', '--pw-chart-line': '2.5', '--pw-chart-own-line': '4' };
    for (const [k, v] of Object.entries(tokens)) wrapper.style.setProperty(k, v);
    document.body.appendChild(wrapper);
    try {
      const own = { colour: '#c13b43', dashed: false, ownCar: true };
      const mate = { colour: '#c13b43', dashed: true, ownCar: false };
      render(Chart, {
        target: wrapper,
        props: { ...base, series: [{ label: 'a', points: [...pts(1), [3.5, 3.4]] as Array<[number, number]>, liveEnd: true, colour: own }, { label: 'b', points: pts(2), colour: mate }] },
      });
      const [a, b, liveA] = last().opts.series.slice(1);
      expect(a.width).toBe(4);
      expect(b.width).toBe(2.5);
      expect(b.dash).toEqual([6, 2]);
      expect(liveA.dash).toEqual([7, 3]);
    } finally {
      cleanup();
      wrapper.remove();
    }
  });
});

describe('Chart: a line of one point', () => {
  /** Whether uPlot shows the points of plot series `i`: `points.show` is a boolean or a function of the plot and index. */
  const shows = (i: number): boolean => {
    const show = last().opts.series[i]?.points?.show;
    return typeof show === 'function' ? show({ data: last().data }, i) === true : show === true;
  };
  const one = (): Array<[number, number]> => [[1, 5]];

  it('shows a single settled point as a dot in its stroke, and no dots on a line of more points', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: one(), colour: { colour: '#c13b43', dashed: false, ownCar: false } }, { label: 'b', points: pts(2) }] });
    const [a] = last().opts.series.slice(1);
    expect(shows(1), 'a: one settled point').toBe(true);
    expect(a.points.fill).toBe(a.stroke);
    expect(shows(2), 'b: three settled points').toBe(false);
  });

  it('shows a single live point as a dot too (lap 1, before any completed lap)', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: [[0.4, -1.2]], liveEnd: true }, { label: 'b', points: pts(2) }] });
    // the settled lines first, then the live lines: series a's live line is plot series 3
    expect(shows(1), 'a: no settled point').toBe(false);
    expect(shows(3), 'a: its live point').toBe(true);
  });
});

describe('Chart: axes, font, black plot', () => {
  it('labels both axes and draws a grid on both', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const [x, y] = last().opts.axes;
    expect(drawnLabel(0, ROOMY)).toBe('Lap');
    expect(drawnLabel(1, ROOMY)).toBe('Gap (s)');
    for (const axis of [x, y]) {
      expect(axis.grid.stroke).toBe('#1c1d21');
      expect(axis.stroke).toBe('#8d9199');
      expect(axis.font).toContain('13px');
      expect(axis.font).toContain('JetBrains Mono');
      expect(axis.labelFont).toContain('13px');
      expect(axis.labelFont).toContain('JetBrains Mono');
    }
  });

  it("draws an axis label's longest form when the plot has room for it", () => {
    render(Chart, { ...base, yLabel: ['behind reference, s', 'behind ref, s', 's'], series: [{ label: 'a', points: pts(1) }] });
    expect(drawnLabel(1, ROOMY)).toBe('behind reference, s');
  });

  it("draws a shorter form of the y label on a low plot, one that fits the plot's height (it never clips)", () => {
    const forms = ['behind reference, s', 'behind ref, s', 's'] as const;
    const low: WidgetSize = { mode: 'compact', cols: 50, rows: 5, px: { width: 400, height: 90 }, dpr: 1 };
    render(Chart, { ...base, yLabel: forms, size: low, series: [{ label: 'a', points: pts(1) }] });
    const plot: Box = { left: 60, top: 10, width: 300, height: 60 };
    const ctx = labelContext(1, 1);
    const drawn = drawnLabel(1, plot, ctx);
    expect(['', ...forms]).toContain(drawn);
    expect(drawn).not.toBe(forms[0]);
    expect(ctx.measureText(drawn).width).toBeLessThanOrEqual(plot.height);
  });

  it('uses a plain numeric x scale for both x kinds', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    expect(last().opts.scales.x.time).toBe(false);
    render(Chart, { ...base, x: { kind: 'sessionTime' }, series: [{ label: 'a', points: pts(1) }] });
    expect(last().opts.scales.x.time).toBe(false);
  });

  it('paints a bg plot background', () => {
    const { container } = render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    expect(last().target).toBeInstanceOf(HTMLElement);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.backgroundColor).toBe('var(--pw-bg)');
  });
});

// The label fit measures what is drawn (review 8, R8-3): uPlot sets the label font on its context before it calls the
// label function, its px size rounded at the pixel ratio (a 14 px font is drawn at 18 px at 1.25, not 17.5), and the font
// may be wider than the grid's cell model. The form drawn is the longest whose measured width fits the plot.
describe('Chart: the axis label is measured as drawn', () => {
  const FORMS = ['behind reference, s', 'behind ref, s', 's'] as const;
  /** A plot of `length` canvas px along the y axis. */
  const tall = (length: number): Box => ({ left: 60, top: 10, width: 300, height: length });
  const ratioOf = uPlot as unknown as { pxRatio: number };
  afterEach(() => {
    ratioOf.pxRatio = 1;
  });

  it('at a pixel ratio of 1, a font wider than the cell model: the form whose measured width fits', () => {
    render(Chart, { ...base, yLabel: FORMS, series: [{ label: 'a', points: pts(1) }] });
    // 13 px glyphs 0.7 em wide: `behind ref, s` is 13 x 9.1 = 118.3 px (13 cells of 7.8 px would be 101.4).
    expect(drawnLabel(1, tall(118), labelContext(1, 1, 0.7))).toBe('s');
    expect(drawnLabel(1, tall(119), labelContext(1, 1, 0.7))).toBe('behind ref, s');
  });

  it("at a pixel ratio of 1.25, a font size uPlot rounds up: 14 px drawn at 18 px", () => {
    document.documentElement.style.setProperty('--pw-font-px', '14px');
    ratioOf.pxRatio = 1.25;
    render(Chart, { ...base, yLabel: FORMS, series: [{ label: 'a', points: pts(1) }] });
    const ctx = labelContext(1, 1.25);
    // `behind ref, s` at 18 px is 13 x 10.8 = 140.4 px; 14 px x 0.6 x 1.25 would be 136.5.
    expect(drawnLabel(1, tall(140), ctx)).toBe('s');
    expect(drawnLabel(1, tall(141), ctx)).toBe('behind ref, s');
    expect(drawnLabel(1, tall(206), ctx)).toBe('behind reference, s');
  });

  it('at a pixel ratio of 1.25, a font size uPlot rounds down: 13 px drawn at 16 px', () => {
    ratioOf.pxRatio = 1.25;
    render(Chart, { ...base, yLabel: FORMS, series: [{ label: 'a', points: pts(1) }] });
    const ctx = labelContext(1, 1.25);
    // `behind ref, s` at 16 px is 13 x 9.6 = 124.8 px; 13 px x 0.6 x 1.25 would be 126.75, too long for 125.
    expect(drawnLabel(1, tall(125), ctx)).toBe('behind ref, s');
    expect(drawnLabel(1, tall(124), ctx)).toBe('s');
  });

  it("measures the x label against the plot's width the same way", () => {
    ratioOf.pxRatio = 1.25;
    render(Chart, { ...base, xLabel: ['lap number', 'lap'], series: [{ label: 'a', points: pts(1) }] });
    const ctx = labelContext(0, 1.25);
    // `lap number` at 16 px is 10 x 9.6 = 96 px.
    expect(drawnLabel(0, { left: 60, top: 10, width: 96, height: 200 }, ctx)).toBe('lap number');
    expect(drawnLabel(0, { left: 60, top: 10, width: 95, height: 200 }, ctx)).toBe('lap');
  });
});

describe('Chart: SC and VSC bands', () => {
  it('paints each band behind the series in bgBand', () => {
    render(Chart, {
      ...base,
      series: [{ label: 'a', points: pts(1) }],
      bands: [{ from: 1, to: 2, kind: 'sc' }, { from: 2.5, to: 3, kind: 'vsc' }],
    });
    const fills: Array<{ style: unknown; args: number[] }> = [];
    const ctx: any = { save() {}, restore() {}, fillStyle: '', fillRect: (...args: number[]) => fills.push({ style: ctx.fillStyle, args }) };
    const u = { ctx, bbox: { left: 0, top: 5, width: 300, height: 100 }, valToPos: (v: number) => v * 10 };
    const hooks = last().opts.hooks.drawClear as Array<(u: unknown) => void>;
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) h(u);
    const bands = fills.filter((f) => f.style === '#141416').map((f) => f.args);
    expect(bands).toContainEqual([10, 5, 10, 100]);
    expect(bands).toContainEqual([25, 5, 5, 100]);
  });

  it('paints no bgBand without bands', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const styles: unknown[] = [];
    const ctx: any = { save() {}, restore() {}, fillStyle: '', fillRect: () => styles.push(ctx.fillStyle) };
    for (const h of (last().opts.hooks?.drawClear ?? []) as Array<(u: unknown) => void>) h({ ctx, bbox: { left: 0, top: 0, width: 1, height: 1 }, valToPos: (v: number) => v });
    expect(styles).not.toContain('#141416');
  });
});

describe('Chart: width', () => {
  it('hands uPlot the panel size', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    expect(last().opts.width).toBe(400);
    expect(last().opts.height).toBe(300);
  });

  it('a wider chart gets the same line widths and axis font (more history, never thicker lines)', () => {
    const series = [{ label: 'a', points: pts(1), colour: { colour: '#c13b43', dashed: false, ownCar: true } }, { label: 'b', points: pts(2) }];
    render(Chart, { ...base, series, size: size(300) });
    const narrow = last().opts;
    render(Chart, { ...base, series, size: size(1200) });
    const wide = last().opts;
    expect(wide.width).toBe(1200);
    expect(wide.series.map((s: any) => s.width)).toEqual(narrow.series.map((s: any) => s.width));
    expect(wide.axes[0].font).toBe(narrow.axes[0].font);
    expect(wide.axes[1].font).toBe(narrow.axes[1].font);
  });

  it('a size change resizes the same plot (setSize) or rebuilds it with the new size', async () => {
    const { rerender } = render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const first = last();
    await rerender({ ...base, series: [{ label: 'a', points: pts(1) }], size: size(800) });
    const resized = first.setSize.mock.calls.some(([s]: any) => s.width === 800);
    const rebuilt = last() !== first && last().opts.width === 800;
    expect(resized || rebuilt).toBe(true);
  });

  it('a data-only change calls setData on the same plot: no new constructor call, no destroy', async () => {
    const { rerender } = render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const first = last();
    const count = instances.length;
    await rerender({ ...base, series: [{ label: 'a', points: [[1, 5], [2, 6], [3, 7], [4, 8]] }] });
    expect(instances.length).toBe(count);
    expect(first.destroy).not.toHaveBeenCalled();
    expect(first.setData).toHaveBeenCalled();
    expect(first.setData.mock.calls.at(-1)![0]).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [null, null, null, null]]);
  });

  it('a size-only change calls setSize on the same plot, without rebuilding', async () => {
    const { rerender } = render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const first = last();
    const count = instances.length;
    await rerender({ ...base, series: [{ label: 'a', points: pts(1) }], size: size(800) });
    expect(instances.length).toBe(count);
    expect(first.destroy).not.toHaveBeenCalled();
    expect(first.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 800 }));
  });

  it('destroys the plot on unmount', () => {
    const { unmount } = render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const inst = last();
    unmount();
    expect(inst.destroy).toHaveBeenCalled();
  });
});
