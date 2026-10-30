// @vitest-environment jsdom
// The chart names each line at its right end (Task L; mockup docs/brainstorms/2026-10-29-sp3-displays/3-gap-chart.html:
// the car code in the line's colour, our car bold). uPlot is replaced by a fake that records its options. Contract the
// tests assume of Chart.svelte beyond chart.test.ts:
//  - the labels are painted on the plot's canvas by a function in `opts.hooks.draw`, with `u.ctx.fillText(text, x, y)`;
//    the test calls every `draw` hook with a fake `u` (`ctx`, `bbox` in canvas pixels, `valToPos(v, scale, true)`,
//    `data`, `scales`, `series`);
//  - at that call, `ctx.fillStyle` is the line's resolved stroke colour, `ctx.globalAlpha` the line's alpha (0.35 for
//    a stale line, else 1) and `ctx.font` the chart font (`--pw-font-px` and `--pw-font`; canvas scale 1 here: `size.dpr`
//    and `uPlot.pxRatio` are 1), bold (`bold` or a weight of 600 to 900) exactly for an own car;
//  - `x` lies right of the plot (`x >= bbox.left + bbox.width`); labels of lines that end on the same value are drawn
//    at least one font height apart;
//  - the column of labels starts one column gap right of the plot: the active theme's `density.columnGapCols` cells of
//    `cellBox(fontPx, lineHeight).width` (wave 2 T6: read as the theme's value, whatever unit `--pw-col-gap` carries);
//  - a line that ends well before the newest x (a retired car, or a lapped car counting its own laps: 1.5 laps or more
//    here) is labelled at its own end instead, inside the plot: `x` from its end's px up to two font heights right of it,
//    `y` within a font height of its end's px; a line ending within the last lap (the running field's live ends, up to
//    0.7 laps before the newest x here) keeps its label in the column. Where between the two the cut lies is free.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '../../src/kit/chart/data.ts';
import { cellBox } from '../../src/kit/size/size.ts';
import type { WidgetSize } from '../../src/kit/types.ts';
import { DEFAULT_THEME, THEMES, applyTheme } from '../../src/theme/index.ts';

const { instances } = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('uplot', () => ({
  default: class {
    static pxRatio = 1;
    opts: unknown;
    data: unknown;
    setSize = vi.fn();
    setData = vi.fn();
    destroy = vi.fn();
    constructor(opts: unknown, data: unknown) {
      this.opts = opts;
      this.data = data;
      instances.push(this);
    }
  },
}));

import Chart from '../../src/kit/chart/Chart.svelte';

const VARS: Record<string, string> = {
  '--pw-bg': '#000001', '--pw-bgBand': '#141416', '--pw-grid': '#1c1d21', '--pw-textDim': '#8d9199',
  '--pw-ownCar': '#ffffff',
  '--pw-series1': '#a10001', '--pw-series2': '#a20002', '--pw-series3': '#a30003',
  '--pw-series4': '#a40004', '--pw-series5': '#a50005', '--pw-series6': '#a60006',
  '--pw-font': '"JetBrains Mono", monospace', '--pw-font-px': '13px',
};
const FONT_PX = 13;
const size: WidgetSize = { mode: 'full', cols: 50, rows: 20, px: { width: 400, height: 300 }, dpr: 1 };
const base = { xLabel: 'Lap', yLabel: 'Gap (s)', x: { kind: 'lap' as const }, size };
/** Three laps ending at y = `end`. */
const pts = (end: number): Array<[number, number]> => [[1, end - 2], [2, end - 1], [3, end]];

type Text = { text: string; x: number; y: number; fillStyle: unknown; font: string; globalAlpha: number };

type Scale = { min: number; max: number };
type Drawn = { texts: Text[]; bbox: { left: number; top: number; width: number; height: number }; valToPos: (v: number, scale: string) => number };

/**
 * Renders the chart, runs its draw hooks on a fake plot of 300 x 200 canvas px and returns the texts drawn; `x` is the
 * fake plot's x scale (default laps 1 to 3, the range of `pts`).
 */
function drawnTexts(series: ChartSeries[], x: Scale = { min: 1, max: 3 }, target?: HTMLElement): Drawn {
  if (target === undefined) render(Chart, { ...base, series });
  else render(Chart, { target, props: { ...base, series } });
  const inst = instances[instances.length - 1];
  const texts: Text[] = [];
  const state: Record<string | symbol, unknown> = { fillStyle: '', strokeStyle: '', font: '', globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic' };
  const stack: Array<Record<string | symbol, unknown>> = [];
  const ctx: any = new Proxy(state, {
    get: (s, k) => {
      if (k === 'save') return () => stack.push({ ...s });
      if (k === 'restore') return () => Object.assign(s, stack.pop() ?? {});
      if (k === 'fillText') {
        return (text: string, x: number, y: number) =>
          texts.push({ text, x, y, fillStyle: s.fillStyle, font: String(s.font), globalAlpha: Number(s.globalAlpha) });
      }
      if (k === 'measureText') return (t: string) => ({ width: t.length * FONT_PX * 0.6 });
      if (k in s) return s[k];
      return () => {};
    },
    set: (s, k, v) => {
      s[k] = v;
      return true;
    },
  });
  const bbox = { left: 50, top: 10, width: 300, height: 200 };
  const y = { min: 0, max: 25 };
  const valToPos = (v: number, scale: string) =>
    scale === 'x' ? bbox.left + ((v - x.min) / (x.max - x.min)) * bbox.width : bbox.top + ((y.max - v) / (y.max - y.min)) * bbox.height;
  const u = {
    ctx,
    bbox,
    data: inst.data,
    series: inst.opts.series,
    scales: { x, y },
    width: size.px.width,
    height: size.px.height,
    valToPos,
  };
  for (const h of (inst.opts.hooks?.draw ?? []) as Array<(u: unknown) => void>) h(u);
  return { texts, bbox, valToPos };
}

const byText = (texts: Text[], text: string): Text => {
  const found = texts.filter((t) => t.text === text);
  expect(found, `one label ${text}`).toHaveLength(1);
  return found[0]!;
};

const rival = { colour: '#c13b43', dashed: false, ownCar: false };
const own = { colour: 'var(--pw-ownCar)', dashed: false, ownCar: true };
const BOLD = /\bbold\b|\b[6-9]00\b/;

beforeEach(() => {
  instances.length = 0;
  for (const [k, v] of Object.entries(VARS)) document.documentElement.style.setProperty(k, v);
});
afterEach(() => {
  cleanup();
  for (const k of Object.keys(VARS)) document.documentElement.style.removeProperty(k);
});

describe('Chart: end-of-line labels', () => {
  it('draws each line\'s car code right of the plot, in the line\'s colour', () => {
    const { texts, bbox } = drawnTexts([
      { label: 'LEC', points: pts(22), colour: rival },
      { label: 'KUH', points: pts(12), colour: own },
      { label: 'REF', points: pts(3) },
    ]);
    expect(texts.map((t) => t.text).filter((t) => ['LEC', 'KUH', 'REF'].includes(t)).sort()).toEqual(['KUH', 'LEC', 'REF']);
    expect(byText(texts, 'LEC').fillStyle).toBe('#c13b43');
    expect(byText(texts, 'KUH').fillStyle).toBe('#ffffff');
    expect(byText(texts, 'REF').fillStyle).toBe('#a10001');
    for (const label of ['LEC', 'KUH', 'REF']) expect(byText(texts, label).x).toBeGreaterThanOrEqual(bbox.left + bbox.width);
  });

  it('draws the labels in the chart font, bold for an own car only', () => {
    const { texts } = drawnTexts([
      { label: 'KUH', points: pts(22), colour: own },
      { label: 'LEC', points: pts(3), colour: rival },
    ]);
    for (const label of ['KUH', 'LEC']) {
      expect(byText(texts, label).font).toContain(`${FONT_PX}px`);
      expect(byText(texts, label).font).toContain('JetBrains Mono');
    }
    expect(byText(texts, 'KUH').font).toMatch(BOLD);
    expect(byText(texts, 'LEC').font).not.toMatch(BOLD);
  });

  it('dims a stale line\'s label like its line', () => {
    const { texts } = drawnTexts([
      { label: 'LEC', points: pts(22), colour: rival, fresh: false },
      { label: 'NOR', points: pts(3), colour: rival },
    ]);
    expect(byText(texts, 'LEC').globalAlpha).toBe(0.35);
    expect(byText(texts, 'NOR').globalAlpha).toBe(1);
  });

  it('draws the labels of lines that end on the same value at least a text row apart', () => {
    const { texts } = drawnTexts([
      { label: 'VER', points: pts(12), colour: rival },
      { label: 'NOR', points: pts(12), colour: rival },
    ]);
    expect(Math.abs(byText(texts, 'VER').y - byText(texts, 'NOR').y)).toBeGreaterThanOrEqual(FONT_PX - 1e-9);
  });
});

describe('Chart: the column of labels', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it.each(THEMES.map((t) => [t.name, t] as const))("%s: starts one column gap of the theme right of the plot", (_name, theme) => {
    applyTheme(theme, document.documentElement);
    const { texts, bbox } = drawnTexts([{ label: 'VER', points: pts(12), colour: rival }]);
    const cell = cellBox(theme.fontPx, theme.density.lineHeight).width;
    expect(byText(texts, 'VER').x - (bbox.left + bbox.width)).toBeCloseTo(theme.density.columnGapCols * cell, 6);
  });

  // A chart reads its tokens where it is drawn, not on the document root (W3-A implement finding): a gallery cell or a
  // panel with another theme sets the variables on a wrapper, and the chart inside takes that theme's gap and font.
  it("takes the gap and the label font of the theme on its own element's ancestors, not the root's", () => {
    const wrapper = document.createElement('div');
    for (const [k, v] of Object.entries({ '--pw-col-gap-cols': '3', '--pw-font-px': '16px', '--pw-weight-bold': '800' })) wrapper.style.setProperty(k, v);
    document.body.appendChild(wrapper);
    try {
      const { texts, bbox } = drawnTexts([{ label: 'KUH', points: pts(20), colour: own }, { label: 'VER', points: pts(4), colour: rival }], undefined, wrapper);
      expect(byText(texts, 'VER').x - (bbox.left + bbox.width)).toBeCloseTo(3 * cellBox(16, DEFAULT_THEME.density.lineHeight).width, 6);
      expect(byText(texts, 'VER').font).toContain('16px');
      expect(byText(texts, 'KUH').font).toMatch(/\b800\b/);
    } finally {
      cleanup();
      wrapper.remove();
    }
  });
});

// A line that ends before the newest x (review RU8, wave 2 T6): its label at the right edge would sit at the y of a
// line that stopped further left, as if a running car were there.
describe('Chart: the label of a line that ends early', () => {
  /** Laps 1 to `to` at a constant y, then a live point at `now` (when given). */
  const run = (to: number, y: number, now?: number): Array<[number, number]> => [
    ...Array.from({ length: to }, (_, i): [number, number] => [i + 1, y]),
    ...(now === undefined ? [] : [[now, y] as [number, number]]),
  ];
  // the newest x is VER's live point at 11.8: LEC 0.7 laps behind on the lead lap, KUH lapped (its own lap 10.3),
  // OCO retired after lap 7
  const field = (): ChartSeries[] => [
    { label: 'VER', points: run(11, 20, 11.8), liveEnd: true, colour: rival },
    { label: 'LEC', points: run(11, 15, 11.1), liveEnd: true, colour: rival },
    { label: 'KUH', points: run(10, 8, 10.3), liveEnd: true, colour: own },
    { label: 'OCO', points: run(7, 3), colour: rival },
  ];
  const X = { min: 1, max: 11.8 };

  it('labels a retired and a lapped car at their own line ends, inside the plot', () => {
    const { texts, bbox, valToPos } = drawnTexts(field(), X);
    for (const [label, endX, endY] of [['KUH', 10.3, 8], ['OCO', 7, 3]] as const) {
      const t = byText(texts, label);
      const end = { x: valToPos(endX, 'x'), y: valToPos(endY, 'y') };
      expect(t.x, label).toBeGreaterThanOrEqual(end.x);
      expect(t.x, label).toBeLessThanOrEqual(end.x + 2 * FONT_PX);
      expect(t.x, label).toBeLessThan(bbox.left + bbox.width);
      expect(Math.abs(t.y - end.y), label).toBeLessThanOrEqual(FONT_PX);
    }
  });

  it('keeps the labels of the running field in the column right of the plot', () => {
    const { texts, bbox } = drawnTexts(field(), X);
    for (const label of ['VER', 'LEC']) expect(byText(texts, label).x, label).toBeGreaterThanOrEqual(bbox.left + bbox.width);
  });

  // Review 2, F3: a line that ends one lap before the newest x (a car just lapped) ends a gap and a label width or less
  // from the plot's right edge. Its label, one gap right of its end, would cross the edge into the label column, where
  // it can sit on a column label's row; it stays inside the plot instead, at its end's y.
  it('keeps the label of a line that ends one lap before the newest x inside the plot, clear of the column', () => {
    // KUH lapped: its live point at 10.8, exactly one lap behind VER's at 11.8
    const series: ChartSeries[] = [
      { label: 'VER', points: run(11, 20, 11.8), liveEnd: true, colour: rival },
      { label: 'LEC', points: run(11, 8, 11.6), liveEnd: true, colour: rival },
      { label: 'KUH', points: run(10, 8, 10.8), liveEnd: true, colour: own },
    ];
    const { texts, bbox, valToPos } = drawnTexts(series, X);
    const kuh = byText(texts, 'KUH');
    const width = 'KUH'.length * cellBox(FONT_PX, DEFAULT_THEME.density.lineHeight).width;
    expect(kuh.x + width).toBeLessThanOrEqual(bbox.left + bbox.width + 1e-9);
    expect(Math.abs(kuh.y - valToPos(8, 'y'))).toBeLessThanOrEqual(FONT_PX);
    expect(byText(texts, 'LEC').x).toBeGreaterThanOrEqual(bbox.left + bbox.width);
  });
});
