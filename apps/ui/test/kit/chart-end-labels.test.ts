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
//    at least one font height apart.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '../../src/kit/chart/data.ts';
import type { WidgetSize } from '../../src/kit/types.ts';

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

/** Renders the chart, runs its draw hooks on a fake plot of 300 x 200 canvas px and returns the texts drawn. */
function drawnTexts(series: ChartSeries[]): { texts: Text[]; bbox: { left: number; top: number; width: number; height: number } } {
  render(Chart, { ...base, series });
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
  const x = { min: 1, max: 3 };
  const u = {
    ctx,
    bbox,
    data: inst.data,
    series: inst.opts.series,
    scales: { x, y },
    width: size.px.width,
    height: size.px.height,
    valToPos: (v: number, scale: string) =>
      scale === 'x'
        ? bbox.left + ((v - x.min) / (x.max - x.min)) * bbox.width
        : bbox.top + ((y.max - v) / (y.max - y.min)) * bbox.height,
  };
  for (const h of (inst.opts.hooks?.draw ?? []) as Array<(u: unknown) => void>) h(u);
  return { texts, bbox };
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
