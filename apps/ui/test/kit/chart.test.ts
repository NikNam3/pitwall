// @vitest-environment jsdom
// The chart (spec 5, brainstorm 7). uPlot is replaced by a fake constructor `new uPlot(opts, data, target)` that records
// `opts`, `data` and `target` in `instances`, and has `setSize(size)`, `setData(data)` and `destroy()` that record their calls.
// Contract the tests assume of Chart.svelte:
//  - `data[0]` is the x values and `data[i + 1]` the y values of `series[i]` (union of x's is not required: each series
//    is given its own points, so the test uses series that share x values);
//  - colours are resolved at construction time from the document root's `--pw-*` variables (uPlot cannot use `var()`);
//  - `opts.series[0]` is the x series; `opts.series[i + 1]` belongs to `series[i]`;
//  - `opts.width` / `opts.height` are `size.px`; a size change calls `setSize({ width, height })` (or rebuilds);
//  - a series with `colour` strokes with `colour.colour` as given (a `var(--pw-ownCar)` reference is resolved), `dash`
//    is set (non-empty array) when `colour.dashed`, and `width` is 3 for an own car and 1.5 otherwise, whatever the
//    chart's width (nothing scales with the panel);
//  - a series without `colour` strokes `series1`, `series2`, ... in order of those without colour;
//  - a series with `fresh === false` has `alpha` 0.35, all others `alpha` 1;
//  - `opts.axes[0]` is x and `opts.axes[1]` is y: `label` is xLabel / yLabel, `grid.stroke` and `ticks.stroke` the resolved
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

import Chart from '../../src/kit/chart/Chart.svelte';
import { carColour } from '../../src/theme/index.ts';

const VARS: Record<string, string> = {
  '--pw-bg': '#000001', '--pw-bgBand': '#141416', '--pw-grid': '#1c1d21', '--pw-textDim': '#8d9199',
  '--pw-ownCar': '#ffffff',
  '--pw-series1': '#a10001', '--pw-series2': '#a20002', '--pw-series3': '#a30003',
  '--pw-series4': '#a40004', '--pw-series5': '#a50005', '--pw-series6': '#a60006',
  '--pw-font': '"JetBrains Mono", monospace', '--pw-font-px': '13px',
};
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

const base = { xLabel: 'Lap', yLabel: 'Gap (s)', x: { kind: 'lap' as const }, size: size(400) };

describe('Chart: series', () => {
  it('hands uPlot the --pw-series1... values for series without a colour, in order', () => {
    render(Chart, { ...base, series: [1, 2, 3, 4, 5, 6].map((k) => ({ label: `s${k}`, points: pts(k) })) });
    const s = last().opts.series;
    expect(s).toHaveLength(7);
    expect(s.slice(1).map((x: any) => x.stroke)).toEqual(['#a10001', '#a20002', '#a30003', '#a40004', '#a50005', '#a60006']);
    expect(s.slice(1).map((x: any) => x.label)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });

  it('gives uPlot x values first and each series y values', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(10) }, { label: 'b', points: pts(20) }] });
    expect(last().data).toEqual([[1, 2, 3], [10, 11, 12], [20, 21, 22]]);
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
    expect(last().opts.series.slice(1).map((s: any) => s.alpha)).toEqual([0.35, 1, 1]);
  });
});

describe('Chart: axes, font, black plot', () => {
  it('labels both axes and draws a grid on both', () => {
    render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const [x, y] = last().opts.axes;
    expect(x.label).toBe('Lap');
    expect(y.label).toBe('Gap (s)');
    for (const axis of [x, y]) {
      expect(axis.grid.stroke).toBe('#1c1d21');
      expect(axis.stroke).toBe('#8d9199');
      expect(axis.font).toContain('13px');
      expect(axis.font).toContain('JetBrains Mono');
      expect(axis.labelFont).toContain('13px');
      expect(axis.labelFont).toContain('JetBrains Mono');
    }
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

  it('destroys the plot on unmount', () => {
    const { unmount } = render(Chart, { ...base, series: [{ label: 'a', points: pts(1) }] });
    const inst = last();
    unmount();
    expect(inst.destroy).toHaveBeenCalled();
  });
});
