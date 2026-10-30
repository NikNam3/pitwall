// @vitest-environment jsdom
// The canvas surface (spec 5, 6.4). jsdom has no 2D context, so `HTMLCanvasElement.prototype.getContext('2d')` is replaced
// by a recording fake. The fake records, for every call of a drawing method, `{ op, args, fillStyle, strokeStyle, font }`
// (the style values at call time) in `ops`: fillRect, strokeRect, fill, stroke, fillText, strokeText, arc, rect, moveTo,
// lineTo, beginPath, clearRect, scale, setTransform, translate, save, restore. fillStyle/strokeStyle/font are plain properties.
// Contract the tests assume of Canvas.svelte:
//  - one `<canvas>` in the component; backing size `width = round(size.px.width * size.dpr)`, `height` likewise;
//    CSS size `style.width = '<px.width>px'`, `style.height = '<px.height>px'`;
//  - the dpr scale reaches the context before `draw` runs: `scale(dpr, dpr)` or `setTransform(dpr, 0, 0, dpr, 0, 0)`;
//    `draw` therefore works in CSS px;
//  - `draw(ctx, api)` runs on mount and again on a size change and on a `draw` prop change;
//  - the tokens are read where the canvas is drawn, at its own element (review 3, U2), through the theme's number reader
//    (`cssNumber`), as the chart and the table do: a theme set on an ancestor (a gallery cell, a panel) counts;
//  - `api.cell` is `{ width: 0.6 * fontPx, height: fontPx * line }` from `--pw-font-px` and `--pw-line`, the default
//    theme's `fontPx` and `density.lineHeight` where they are unset; `ctx.font` is `<fontPx>px <--pw-font>`;
//  - `api.role(r)` returns the resolved value of `--pw-<r>` (computed style of the canvas), not `var(...)`;
//  - `api.mark(x, y, { role?, fresh?, label? })` draws a mark at (x, y) with at least one fill/stroke/fillRect op in the
//    colour of `role` (default `text`), or `textFaint` when `fresh === false` (the kit dims it, not the widget); a
//    `label` is drawn with `fillText` at the same colour; every colour-bearing op of a mark has that one colour.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetSize } from '../../src/kit/types.ts';
import Canvas from '../../src/kit/canvas/Canvas.svelte';
import { DEFAULT_THEME } from '../../src/theme/index.ts';

type Op = { op: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown; font: unknown };
let ops: Op[] = [];
const METHODS = ['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'arc', 'rect', 'moveTo', 'lineTo', 'beginPath', 'closePath', 'clearRect', 'scale', 'setTransform', 'translate', 'save', 'restore'];
function fakeContext(): unknown {
  const ctx: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic' };
  for (const m of METHODS) ctx[m] = (...args: unknown[]) => ops.push({ op: m, args, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, font: ctx.font });
  return ctx;
}

const VARS: Record<string, string> = {
  '--pw-text': '#d9dbe0', '--pw-textFaint': '#5c6068', '--pw-best': '#a1b2c3', '--pw-font-px': '13px', '--pw-line': '1.4',
};
const size = (width: number, height: number, dpr: number): WidgetSize => ({ mode: 'full', cols: 10, rows: 5, px: { width, height }, dpr });
const colourOps = (from: number) => ops.slice(from).filter((o) => ['fillRect', 'fill', 'fillText'].includes(o.op) || ['stroke', 'strokeRect', 'strokeText'].includes(o.op));
const colourOf = (o: Op) => (o.op.startsWith('stroke') ? o.strokeStyle : o.fillStyle);

beforeEach(() => {
  ops = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
  for (const [k, v] of Object.entries(VARS)) document.documentElement.style.setProperty(k, v);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const k of Object.keys(VARS)) document.documentElement.style.removeProperty(k);
});

describe('Canvas: size and dpr', () => {
  it.each([[1], [2], [1.5]])('backing size is CSS size x dpr %s', (dpr) => {
    const { container } = render(Canvas, { size: size(300, 120, dpr), draw: () => {} });
    const c = container.querySelector('canvas') as HTMLCanvasElement;
    expect(c.width).toBe(Math.round(300 * dpr));
    expect(c.height).toBe(Math.round(120 * dpr));
    expect(c.style.width).toBe('300px');
    expect(c.style.height).toBe('120px');
  });

  it('scales the context by dpr before draw runs', () => {
    let opsAtDraw = 0;
    render(Canvas, { size: size(100, 50, 2), draw: () => { opsAtDraw = ops.length; } });
    const scaled = ops.slice(0, opsAtDraw).some(
      (o) => (o.op === 'scale' && o.args[0] === 2 && o.args[1] === 2) || (o.op === 'setTransform' && o.args[0] === 2 && o.args[3] === 2),
    );
    expect(scaled).toBe(true);
  });
});

describe('Canvas: redraw', () => {
  it('draws on mount, on a size change and on a draw change', async () => {
    const draw = vi.fn();
    const { rerender } = render(Canvas, { size: size(100, 50, 1), draw });
    expect(draw).toHaveBeenCalledTimes(1);
    await rerender({ size: size(200, 50, 1), draw });
    expect(draw).toHaveBeenCalledTimes(2);
    const next = vi.fn();
    await rerender({ size: size(200, 50, 1), draw: next });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('hands draw the context and an api with the cell box', () => {
    const draw = vi.fn();
    render(Canvas, { size: size(100, 50, 1), draw });
    const [ctx, api] = draw.mock.calls[0]!;
    expect(typeof (ctx as { fillRect: unknown }).fillRect).toBe('function');
    expect(api.cell.width).toBeCloseTo(7.8);
    expect(api.cell.height).toBeCloseTo(18.2);
  });
});

describe('Canvas: roles and marks', () => {
  it('api.role resolves the CSS variable as the canvas sees it (here inherited from the root)', () => {
    let got = '';
    render(Canvas, { size: size(100, 50, 1), draw: (_c: unknown, api: any) => { got = api.role('best'); } });
    expect(got).toBe('#a1b2c3');
  });

  it('mark draws in the given role', () => {
    render(Canvas, { size: size(100, 50, 1), draw: (_c: unknown, api: any) => api.mark(10, 20, { role: 'best' }) });
    const drawn = colourOps(0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((o) => colourOf(o) === '#a1b2c3')).toBe(true);
  });

  it('mark defaults to the text role', () => {
    render(Canvas, { size: size(100, 50, 1), draw: (_c: unknown, api: any) => api.mark(10, 20, {}) });
    const drawn = colourOps(0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((o) => colourOf(o) === '#d9dbe0')).toBe(true);
  });

  it('mark with fresh: false draws with the textFaint role whatever role it was given', () => {
    render(Canvas, { size: size(100, 50, 1), draw: (_c: unknown, api: any) => api.mark(10, 20, { role: 'best', fresh: false, label: 'P1' }) });
    const drawn = colourOps(0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((o) => colourOf(o) === '#5c6068')).toBe(true);
  });

  it('mark with fresh: true keeps its role, and a label is drawn as text at the mark colour', () => {
    render(Canvas, { size: size(100, 50, 1), draw: (_c: unknown, api: any) => api.mark(10, 20, { role: 'best', fresh: true, label: 'P1' }) });
    const text = ops.filter((o) => o.op === 'fillText');
    expect(text.map((o) => o.args[0])).toEqual(['P1']);
    expect(text[0]!.fillStyle).toBe('#a1b2c3');
  });
});

// A canvas reads its tokens where it is drawn, not on the document root (review 3, U2, as the chart's "the theme of its
// own element"): a gallery cell or a panel with another theme sets the variables on a wrapper, and the canvas inside
// draws with that theme's font, line height and colours.
describe('Canvas: the theme of its own element', () => {
  const inWrapper = (tokens: Record<string, string>, draw: (ctx: unknown, api: any) => void) => {
    const wrapper = document.createElement('div');
    for (const [k, v] of Object.entries(tokens)) wrapper.style.setProperty(k, v);
    document.body.appendChild(wrapper);
    render(Canvas, { target: wrapper, props: { size: size(100, 50, 1), draw } });
    return wrapper;
  };
  let wrapper: HTMLElement | undefined;
  afterEach(() => {
    wrapper?.remove();
    wrapper = undefined;
    document.documentElement.style.removeProperty('--pw-font');
  });

  it("measures the cell box and sets the font with the font size, line height and font set on an ancestor, not the root's", () => {
    document.documentElement.style.setProperty('--pw-font', 'RootMono');
    let cell: { width: number; height: number } | undefined;
    let font = '';
    wrapper = inWrapper({ '--pw-font-px': '20px', '--pw-line': '1.5', '--pw-font': 'CellMono' }, (ctx, api) => {
      cell = api.cell;
      font = (ctx as { font: string }).font;
    });
    expect(cell?.width).toBeCloseTo(12);
    expect(cell?.height).toBeCloseTo(30);
    expect(font).toBe('20px CellMono');
  });

  it("resolves roles and draws marks in the colours set on an ancestor, not the root's", () => {
    let got = '';
    wrapper = inWrapper({ '--pw-best': '#0a0b0c' }, (_c, api) => {
      got = api.role('best');
      api.mark(10, 20, { role: 'best' });
    });
    expect(got).toBe('#0a0b0c');
    expect(colourOps(0).every((o) => colourOf(o) === '#0a0b0c')).toBe(true);
  });

  it("falls back to the default theme's font size and line height where the tokens are unset (never NaN)", () => {
    for (const k of ['--pw-font-px', '--pw-line']) document.documentElement.style.removeProperty(k);
    const draw = vi.fn();
    render(Canvas, { size: size(100, 50, 1), draw });
    const [, api] = draw.mock.calls[0]!;
    expect(api.cell.width).toBeCloseTo(0.6 * DEFAULT_THEME.fontPx);
    expect(api.cell.height).toBeCloseTo(DEFAULT_THEME.fontPx * DEFAULT_THEME.density.lineHeight);
  });
});
