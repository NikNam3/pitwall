// @vitest-environment jsdom
// The kit chart draws point marks, pinned marks, an sd band and a tyre-age x axis (task 13k, ruling R27; C65, C68, C69;
// mockup docs/design/2026-11-06-sp4.1a/source-badge.html, the stint scatter: used laps as dots, excluded laps as faint
// rings pinned at the edge when off-scale, a down-weighted lap as a dotted ring, the fit line with its band, x = tyre
// age, laps). uPlot is replaced by a fake that records its options (its static range helpers are uPlot's own). Contract
// the tests assume of Chart.svelte, additive to chart.test.ts and chart-end-labels.test.ts:
//  - props: `marks?: ChartMark[]` (data.ts); `ChartSeries.band?: BandPoint[]`; `x.kind` may be `'tyreAge'`;
//  - marks and bands are painted on the plot's canvas by functions in `opts.hooks` (`drawClear` and `draw`); the test
//    calls every function of both with a fake plot `u` (`ctx`, `bbox` in canvas px, `valToPos(v, scale, true)`,
//    `scales` with the x and y scales' `min` and `max`, `data`, `series`); canvas scale 1 (`uPlot.pxRatio` 1);
//  - neither is a uPlot series: `opts.series` and the data stay those of the lines (chart.test.ts);
//  - a mark is a circle `ctx.arc(cx, cy, r, ...)` (r > 0) centred at `valToPos(x, 'x', true)`, `valToPos(y, 'y', true)`:
//    a `dot` is filled in its role; a `ring` is stroked in its role with no line dash and not filled in it; a
//    `dottedRing` is stroked in its role with a non-empty line dash (`ctx.setLineDash`); roles are resolved from the
//    chart element's `--pw-*` variables;
//  - a pinned mark whose y lies outside the y scale (`u.scales.y`) is drawn at that edge: its centre within 12 px inside
//    the plot's top (above the scale) or bottom (below it); a pinned mark inside the scale is drawn at its y;
//  - `opts.scales.y.range` (a function `(u, min, max, key)` or a `[min, max]` pair) covers `yExtent(series, marks)` when
//    marks or bands are given, so a pinned mark never widens it;
//  - a series' band is one filled polygon (`moveTo`, `lineTo`, `fill()`) through `bandOutline(band)` in canvas px, in the
//    series' resolved stroke colour at a `globalAlpha` between 0 and 1; a series without a band paints none;
//  - `x.kind === 'tyreAge'`: `opts.scales.x.range` (called as `range(u)`) is `visibleXRange` over the x of the lines and
//    the marks, so the axis runs from 0 to one lap past the oldest age whatever the width; `opts.axes[0].incrs` (an
//    array, or a function uPlot calls) holds whole laps only; the x label is drawn from `xLabel` as on the other kinds;
//    the line ending at the oldest age is labelled in the column right of the plot, an earlier stint's line (ending
//    well before it) at its own end inside the plot;
//  - new marks reach the same plot or a rebuilt one: the plot's hooks then draw the new marks.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bandOutline, type BandPoint, type ChartMark, type ChartSeries } from '../../src/kit/chart/data.ts';
import type { WidgetSize } from '../../src/kit/types.ts';

const { instances } = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('uplot', async () => {
  const actual = (await vi.importActual<{ default: any }>('uplot')).default;
  return {
    default: class {
      static pxRatio = 1;
      static rangeNum = actual.rangeNum;
      static rangeLog = actual.rangeLog;
      static fmtNum = actual.fmtNum;
      opts: unknown;
      data: unknown;
      setSize = vi.fn();
      setData = vi.fn();
      setScale = vi.fn();
      redraw = vi.fn();
      destroy = vi.fn();
      constructor(opts: unknown, data: unknown) {
        this.opts = opts;
        this.data = data;
        instances.push(this);
      }
    },
  };
});

import Chart from '../../src/kit/chart/Chart.svelte';

const VARS: Record<string, string> = {
  '--pw-bg': '#000001', '--pw-bgBand': '#141416', '--pw-grid': '#1c1d21', '--pw-text': '#d9dbe0',
  '--pw-textDim': '#8d9199', '--pw-textFaint': '#5c6068', '--pw-ownCar': '#ffffff',
  '--pw-series1': '#a10001', '--pw-series2': '#a20002', '--pw-series3': '#a30003',
  '--pw-series4': '#a40004', '--pw-series5': '#a50005', '--pw-series6': '#a60006',
  '--pw-font': '"JetBrains Mono", monospace', '--pw-font-px': '13px',
};
const FONT_PX = 13;
const size = (cols: number): WidgetSize => ({ mode: 'full', cols, rows: 16, px: { width: cols * 8, height: 300 }, dpr: 1 });
const OWN = { colour: 'var(--pw-ownCar)', dashed: false, ownCar: true };
const DIM = { colour: 'var(--pw-textDim)', dashed: false, ownCar: false };
const base = { xLabel: ['tyre age, laps', 'tyre age'] as const, yLabel: ['fuel-corrected lap'] as const, x: { kind: 'tyreAge' as const }, size: size(72) };
const lapBase = { ...base, xLabel: ['Lap'] as const, x: { kind: 'lap' as const } };

const mark = (x: number, y: number, over: Partial<ChartMark> = {}): ChartMark => ({ x, y, shape: 'dot', role: 'ownCar', ...over });
/** A fit line from tyre age 1 to `to`, 50 ms a lap slower from 90 900 ms. */
const fit = (to: number): Array<[number, number]> => Array.from({ length: to }, (_, i) => [i + 1, 90_900 + 50 * i] as [number, number]);

beforeEach(() => {
  instances.length = 0;
  for (const [k, v] of Object.entries(VARS)) document.documentElement.style.setProperty(k, v);
});
afterEach(() => {
  cleanup();
  for (const k of Object.keys(VARS)) document.documentElement.style.removeProperty(k);
});

const last = (): any => instances[instances.length - 1];

// ---- the fake plot: 400 x 200 canvas px at (50, 10), x 0 to 24, y 90 000 to 92 000 ms

const BBOX = { left: 50, top: 10, width: 400, height: 200 };
const SCALES = { x: { min: 0, max: 24 }, y: { min: 90_000, max: 92_000 } };
const X = (v: number): number => BBOX.left + ((v - SCALES.x.min) / (SCALES.x.max - SCALES.x.min)) * BBOX.width;
const Y = (v: number): number => BBOX.top + ((SCALES.y.max - v) / (SCALES.y.max - SCALES.y.min)) * BBOX.height;
const BOTTOM = BBOX.top + BBOX.height;
const RIGHT = BBOX.left + BBOX.width;

type Arc = { x: number; y: number; r: number };
type Paint = { op: 'fill' | 'stroke'; arcs: Arc[]; pts: Array<[number, number]>; style: unknown; alpha: number; dash: number[] };
type Text = { text: string; x: number; y: number };
type Drawn = { paints: Paint[]; texts: Text[] };

/** A context that records each fill and stroke with the arcs and the moveTo/lineTo points of its path. */
function recordingContext(): { ctx: any; drawn: Drawn } {
  const drawn: Drawn = { paints: [], texts: [] };
  const state: Record<string | symbol, unknown> = {
    fillStyle: '', strokeStyle: '', font: '', globalAlpha: 1, lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic', dash: [] as number[],
  };
  const stack: Array<Record<string | symbol, unknown>> = [];
  let path = { arcs: [] as Arc[], pts: [] as Array<[number, number]> };
  const paint = (op: Paint['op']) => () =>
    drawn.paints.push({
      op,
      arcs: [...path.arcs],
      pts: [...path.pts],
      style: op === 'fill' ? state.fillStyle : state.strokeStyle,
      alpha: Number(state.globalAlpha),
      dash: [...(state.dash as number[])],
    });
  const methods: Record<string, (...a: any[]) => unknown> = {
    save: () => stack.push({ ...state, dash: [...(state.dash as number[])] }),
    restore: () => Object.assign(state, stack.pop() ?? {}),
    beginPath: () => (path = { arcs: [], pts: [] }),
    moveTo: (x: number, y: number) => path.pts.push([x, y]),
    lineTo: (x: number, y: number) => path.pts.push([x, y]),
    arc: (x: number, y: number, r: number) => path.arcs.push({ x, y, r }),
    fill: paint('fill'),
    stroke: paint('stroke'),
    setLineDash: (d: number[]) => (state.dash = [...d]),
    getLineDash: () => [...(state.dash as number[])],
    fillText: (text: string, x: number, y: number) => drawn.texts.push({ text, x, y }),
    measureText: (t: string) => ({ width: t.length * FONT_PX * 0.6 }),
  };
  const ctx = new Proxy(state, {
    get: (s, k) => (typeof k === 'string' && k in methods ? methods[k] : k in s ? s[k] : () => {}),
    set: (s, k, v) => {
      s[k] = v;
      return true;
    },
  });
  return { ctx, drawn };
}

/** Runs every `drawClear` and `draw` hook of the newest plot on the fake plot and returns what they painted. */
function draw(inst: any = last()): Drawn {
  const { ctx, drawn } = recordingContext();
  const u = {
    ctx,
    bbox: BBOX,
    valToPos: (v: number, scale: string) => (scale === 'x' ? X(v) : Y(v)),
    posToVal: (p: number, scale: string) =>
      scale === 'x' ? SCALES.x.min + ((p - BBOX.left) / BBOX.width) * 24 : SCALES.y.max - ((p - BBOX.top) / BBOX.height) * 2000,
    scales: SCALES,
    data: inst.data,
    series: inst.opts.series,
    width: 400,
    height: 300,
  };
  const hooks = inst.opts.hooks ?? {};
  for (const h of [...(hooks.drawClear ?? []), ...(hooks.draw ?? [])] as Array<(u: unknown) => void>) h(u);
  return drawn;
}

/** The painted circles centred at (cx, cy) within half a pixel. */
const at = (d: Drawn, cx: number, cy: number): Paint[] =>
  d.paints.filter((p) => p.arcs.some((a) => Math.abs(a.x - cx) <= 0.5 && Math.abs(a.y - cy) <= 0.5 && a.r > 0));
/** The painted circles at x = cx (any y). */
const atX = (d: Drawn, cx: number): Array<{ paint: Paint; arc: Arc }> =>
  d.paints.flatMap((p) => p.arcs.filter((a) => Math.abs(a.x - cx) <= 0.5 && a.r > 0).map((arc) => ({ paint: p, arc })));
/** The filled polygons: paths of three or more points and no arc. */
const polygons = (d: Drawn): Paint[] => d.paints.filter((p) => p.op === 'fill' && p.arcs.length === 0 && p.pts.length >= 3);

/** The y range the plot's y scale is given, for lines whose data spans [min, max]. */
function yRange(min: number, max: number): [number, number] {
  const range = last().opts.scales?.y?.range;
  const u = { data: last().data, series: last().opts.series, scales: { y: { min, max } } };
  if (typeof range === 'function') return range(u, min, max, 'y') as [number, number];
  expect(Array.isArray(range), 'opts.scales.y.range is a function or a [min, max] pair').toBe(true);
  return range as [number, number];
}

describe('Chart: point marks', () => {
  const marks = [
    mark(4, 91_000, { shape: 'dot', role: 'ownCar' }),
    mark(8, 91_200, { shape: 'ring', role: 'textFaint' }),
    mark(12, 91_500, { shape: 'dottedRing', role: 'textDim' }),
  ];

  it('fills a dot in its role at its point', () => {
    render(Chart, { ...base, series: [], marks });
    const paints = at(draw(), X(4), Y(91_000));
    expect(paints.some((p) => p.op === 'fill' && p.style === '#ffffff'), 'dot filled in ownCar').toBe(true);
  });

  it('strokes a ring in its role, solid and not filled', () => {
    render(Chart, { ...base, series: [], marks });
    const paints = at(draw(), X(8), Y(91_200));
    const ring = paints.filter((p) => p.op === 'stroke' && p.style === '#5c6068');
    expect(ring.length, 'ring stroked in textFaint').toBeGreaterThan(0);
    expect(ring.every((p) => p.dash.length === 0), 'ring solid').toBe(true);
    expect(paints.some((p) => p.op === 'fill' && p.style === '#5c6068'), 'ring not filled in its role').toBe(false);
  });

  it('strokes a dotted ring in its role with a line dash', () => {
    render(Chart, { ...base, series: [], marks });
    const paints = at(draw(), X(12), Y(91_500));
    const ring = paints.filter((p) => p.op === 'stroke' && p.style === '#8d9199');
    expect(ring.length, 'dotted ring stroked in textDim').toBeGreaterThan(0);
    expect(ring.every((p) => p.dash.length > 0), 'dotted ring dashed').toBe(true);
    expect(paints.some((p) => p.op === 'fill' && p.style === '#8d9199'), 'dotted ring not filled in its role').toBe(false);
  });

  it('draws the marks with the lines, and makes them no uPlot series', () => {
    const series: ChartSeries[] = [{ label: 'M L01–', points: fit(12), colour: OWN }];
    render(Chart, { ...base, series, marks });
    expect(last().opts.series).toHaveLength(3);
    expect(last().data).toHaveLength(3);
    const d = draw();
    for (const m of marks) expect(at(d, X(m.x), Y(m.y)).length, `mark at ${m.x}`).toBeGreaterThan(0);
  });

  it('reads the roles at its own element: a theme on an ancestor counts', () => {
    const wrapper = document.createElement('div');
    wrapper.style.setProperty('--pw-ownCar', '#fefefe');
    document.body.appendChild(wrapper);
    try {
      render(Chart, { target: wrapper, props: { ...base, series: [], marks: [mark(4, 91_000)] } });
      expect(at(draw(), X(4), Y(91_000)).some((p) => p.op === 'fill' && p.style === '#fefefe')).toBe(true);
    } finally {
      cleanup();
      wrapper.remove();
    }
  });

  it('draws new marks after a change, on the same plot or a rebuilt one', async () => {
    const { rerender } = render(Chart, { ...base, series: [{ label: 'a', points: fit(12), colour: OWN }], marks: [mark(4, 91_000)] });
    const first = last();
    await rerender({ ...base, series: [{ label: 'a', points: fit(12), colour: OWN }], marks: [mark(4, 91_000), mark(5, 91_300, { shape: 'ring', role: 'textFaint' })] });
    if (last() === first) expect(first.redraw.mock.calls.length + first.setData.mock.calls.length, 'the plot redraws').toBeGreaterThan(0);
    expect(at(draw(), X(5), Y(91_300)).some((p) => p.op === 'stroke' && p.style === '#5c6068')).toBe(true);
  });
});

describe('Chart: pinned marks', () => {
  const series: ChartSeries[] = [{ label: 'M L01–', points: [[1, 90_900], [20, 91_400]], colour: OWN }];
  const marks = [
    mark(2, 91_000),
    mark(3, 91_500),
    mark(9, 104_000, { shape: 'ring', role: 'textFaint', pinned: true }),
    mark(10, 80_000, { shape: 'ring', role: 'textFaint', pinned: true }),
    mark(11, 91_200, { shape: 'ring', role: 'textFaint', pinned: true }),
  ];

  it('never widens the y range: it covers the lines and the other marks only', () => {
    render(Chart, { ...base, series, marks });
    const [lo, hi] = yRange(90_900, 91_400);
    expect(lo).toBeLessThanOrEqual(90_900);
    expect(hi).toBeGreaterThanOrEqual(91_500);
    expect(hi, 'the pinned 104 000 is off-scale').toBeLessThan(104_000);
    expect(lo, 'the pinned 80 000 is off-scale').toBeGreaterThan(80_000);
  });

  it('draws a pinned mark above the scale at the top edge, in its shape and role', () => {
    render(Chart, { ...base, series, marks });
    const drawn = atX(draw(), X(9));
    expect(drawn.length).toBeGreaterThan(0);
    for (const { paint, arc } of drawn) {
      expect(arc.y, 'inside the plot, near its top').toBeGreaterThanOrEqual(BBOX.top);
      expect(arc.y).toBeLessThanOrEqual(BBOX.top + 12);
      expect(paint.op === 'stroke' && paint.style === '#5c6068' && paint.dash.length === 0).toBe(true);
    }
  });

  it('draws a pinned mark below the scale at the bottom edge', () => {
    render(Chart, { ...base, series, marks });
    const drawn = atX(draw(), X(10));
    expect(drawn.length).toBeGreaterThan(0);
    for (const { arc } of drawn) {
      expect(arc.y, 'inside the plot, near its bottom').toBeLessThanOrEqual(BOTTOM);
      expect(arc.y).toBeGreaterThanOrEqual(BOTTOM - 12);
    }
  });

  it('draws a pinned mark inside the scale at its own y', () => {
    render(Chart, { ...base, series, marks });
    expect(at(draw(), X(11), Y(91_200)).some((p) => p.op === 'stroke' && p.style === '#5c6068')).toBe(true);
  });

  it('shows the laps of a stint without a fit: the y range covers the marks alone', () => {
    render(Chart, { ...base, series: [], marks: [mark(2, 91_000), mark(3, 91_600), mark(1, 93_800, { shape: 'ring', role: 'textFaint', pinned: true })] });
    const [lo, hi] = yRange(0, 0);
    expect(lo).toBeLessThanOrEqual(91_000);
    expect(hi).toBeGreaterThanOrEqual(91_600);
    expect(hi).toBeLessThan(93_800);
  });
});

describe('Chart: the sd band', () => {
  const band: BandPoint[] = [{ x: 1, y: 90_900, sd: 100 }, { x: 12, y: 91_200, sd: 150 }, { x: 23, y: 91_500, sd: 200 }];
  const line: Array<[number, number]> = band.map((p) => [p.x, p.y]);
  const outlinePx = (b: BandPoint[]) => bandOutline(b).map(([x, y]) => [X(x), Y(y)] as [number, number]);
  const near = (a: Array<[number, number]>, b: Array<[number, number]>) =>
    a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) <= 0.5 && Math.abs(p[1] - b[i]![1]) <= 0.5);
  const sorted = (pts: Array<[number, number]>) => [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  it("paints the band through y ± sd in the line's colour, translucent", () => {
    render(Chart, { ...base, series: [{ label: 'M L01–', points: line, band, colour: OWN }] });
    const bands = polygons(draw()).filter((p) => near(sorted(p.pts), sorted(outlinePx(band))));
    expect(bands.length, 'one polygon through the outline').toBeGreaterThan(0);
    for (const b of bands) {
      expect(b.style).toBe('#ffffff');
      expect(b.alpha).toBeGreaterThan(0);
      expect(b.alpha).toBeLessThan(1);
    }
  });

  it("paints a plain series' band in its series colour, and each series its own band", () => {
    const other: BandPoint[] = [{ x: 1, y: 91_300, sd: 50 }, { x: 8, y: 91_600, sd: 80 }];
    render(Chart, {
      ...base,
      series: [
        { label: 'S L01–08', points: other.map((p) => [p.x, p.y] as [number, number]), band: other, colour: DIM },
        { label: 'plain', points: line, band },
      ],
    });
    const drawn = polygons(draw());
    expect(drawn.some((p) => p.style === '#8d9199' && near(sorted(p.pts), sorted(outlinePx(other)))), 'the dim band').toBe(true);
    expect(drawn.some((p) => p.style === '#a10001' && near(sorted(p.pts), sorted(outlinePx(band)))), 'the series1 band').toBe(true);
  });

  it('paints no band for a series without one', () => {
    render(Chart, { ...base, series: [{ label: 'M L01–', points: line, colour: OWN }] });
    expect(polygons(draw()).filter((p) => p.style === '#ffffff')).toEqual([]);
  });

  it('makes the band no uPlot series: the data stay the lines', () => {
    render(Chart, { ...base, series: [{ label: 'M L01–', points: line, band, colour: OWN }] });
    expect(last().opts.series).toHaveLength(3);
    expect(last().data).toEqual([[1, 12, 23], [90_900, 91_200, 91_500], [null, null, null]]);
  });

  it('widens the y range to the whole band', () => {
    render(Chart, { ...base, series: [{ label: 'M L01–', points: line, band, colour: OWN }] });
    const [lo, hi] = yRange(90_900, 91_500);
    expect(lo).toBeLessThanOrEqual(90_800);
    expect(hi).toBeGreaterThanOrEqual(91_700);
  });
});

describe('Chart: the tyre-age x axis', () => {
  type Box = { left: number; top: number; width: number; height: number };
  const ROOMY: Box = { left: 60, top: 10, width: 300, height: 200 };
  /** What uPlot draws as the x axis' label on a plot of `bbox` (canvas px, 0.6 em glyphs). */
  const xLabelDrawn = (bbox: Box): string => {
    const label: unknown = last().opts.axes[0].label;
    const ctx = { font: `${FONT_PX}px x`, measureText: (t: string) => ({ width: t.length * 0.6 * FONT_PX }) };
    return typeof label === 'function' ? String(label({ bbox, ctx }, 0)) : String(label);
  };
  const xRange = (): [number, number] => {
    const range = last().opts.scales.x.range;
    return (typeof range === 'function' ? range({ data: last().data, scales: {} }, 0, 0, 'x') : range) as [number, number];
  };
  const marks = [mark(1, 93_800, { shape: 'ring', role: 'textFaint', pinned: true }), ...fit(23).map(([x, y]) => mark(x, y))];

  it('runs from a new tyre to one lap past the oldest age, over the lines and the marks', () => {
    render(Chart, { ...base, series: [{ label: 'M L01–', points: fit(20), colour: OWN }], marks });
    expect(xRange()).toEqual([0, 24]);
    expect(last().opts.scales.x.time).toBe(false);
  });

  it('shows the whole stint whatever the width', () => {
    render(Chart, { ...base, size: size(36), series: [{ label: '', points: fit(23), colour: OWN }], marks });
    expect(xRange()).toEqual([0, 24]);
    render(Chart, { ...base, size: size(120), series: [{ label: '', points: fit(23), colour: OWN }], marks });
    expect(xRange()).toEqual([0, 24]);
  });

  it('covers the marks of a stint without a fit', () => {
    render(Chart, { ...base, series: [], marks: [mark(2, 91_000), mark(14, 91_600)] });
    expect(xRange()).toEqual([0, 15]);
  });

  it('ticks whole laps only, and labels the axis from xLabel', () => {
    render(Chart, { ...base, series: [{ label: 'M L01–', points: fit(23), colour: OWN }], marks });
    const incrs: unknown = last().opts.axes[0].incrs;
    const steps = (typeof incrs === 'function' ? incrs({ data: last().data }, 0, 0, 24, 400, 50) : incrs) as number[];
    expect(Array.isArray(steps) && steps.length > 0, 'axes[0].incrs').toBe(true);
    expect(steps.every((s) => Number.isInteger(s) && s >= 1), `whole laps: ${steps}`).toBe(true);
    expect(xLabelDrawn(ROOMY)).toBe('tyre age, laps');
  });

  it('labels the newest stint in the column and an earlier stint at its own end', () => {
    render(Chart, {
      ...base,
      series: [
        { label: 'S L01–08', points: fit(8), colour: DIM },
        { label: 'M L09–', points: fit(23), colour: OWN },
      ],
      marks,
    });
    const texts = draw().texts;
    const current = texts.find((t) => t.text === 'M L09–');
    const earlier = texts.find((t) => t.text === 'S L01–08');
    expect(current?.x, 'the newest stint right of the plot').toBeGreaterThanOrEqual(RIGHT);
    expect(earlier?.x, 'an earlier stint inside the plot').toBeLessThan(RIGHT);
    expect(earlier!.x).toBeGreaterThanOrEqual(X(8));
  });

  it('leaves a lap axis without whole-lap ticks forced and following the width', () => {
    render(Chart, { ...lapBase, size: size(10), series: [{ label: 'a', points: [[1, 1], [40, 2]] }] });
    const range = last().opts.scales.x.range({ data: last().data }, 0, 0, 'x') as [number, number];
    expect(range[1]).toBe(40);
    expect(range[0]).toBeGreaterThan(1);
  });
});
