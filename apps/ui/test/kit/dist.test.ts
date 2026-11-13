// @vitest-environment jsdom
// The distribution strip (SP4.3b2 Task 3; docs/design/2026-11-12-sp4.3b/README.md "What is drawn", gen.mjs `DIST`; Q2 A,
// Q3 A). Contracts assumed:
//  - `kit/dist/dist.ts`:
//    `Bar = { x: number; w: number; h: number; role: Role }`, `GainZero = { between: number } | { underBin: number }`;
//    `sharedScale(series)`: the largest bin over every series; 0 (or no bins) → 1;
//    `placeBars(pmf, scale, box, lit?)`: one cell per bin, `box.w / pmf.length` wide; a bar per non-zero bin, inside its
//      cell (`x ≥ i·cell`, `x + w ≤ (i+1)·cell`, `w > 0`), `h = box.h · p / scale`; role `text`, `ownCar` when lit;
//    `gainBars(bins, scale, box, zero, lit?)`: the same geometry; a bin left of zero (`i < between`, `i < underBin`)
//      `textFaint`, the rest `textDim`, every bar `ownCar` when lit;
//  - `kit/dist/DistStrip.svelte`: root `<svg class="dist-strip" data-form="places|gain" data-cells=n viewBox="0 0 W H">`
//    (one cell `W / n` wide); one `rect.bar` per bar of `placeBars` / `gainBars` (its `x`, `width`, `height`
//    attributes; its colour `role(bar.role)` as the `fill` attribute or style), standing on one baseline;
//    places: `rect.our-place` under the cell of `ourPlace` (1-based; `x = (ourPlace − 1)·cell`, `width = cell`, its
//      top at or below the bars' baseline) in the `text` role (white), absent without `ourPlace`;
//    gain: `line.zero` in the `text` role, `data-zero="between"`: at `x = between·cell`, from the top to the bottom
//      (at least 80 % of H), or `data-zero="under"`: at `x = (underBin + 0.5)·cell`, a tick below the baseline;
//      `line.mark` at `x = markAtBin·cell` (fractional allowed), dotted (`stroke-dasharray`), in the `ownCar` role,
//      absent without `markAtBin`.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DistStrip from '../../src/kit/dist/DistStrip.svelte';
import { gainBars, placeBars, sharedScale } from '../../src/kit/dist/dist.ts';
import { role } from '../../src/theme/index.ts';

afterEach(cleanup);

const BOX = { w: 200, h: 20 };
const num = (el: Element, a: string): number => Number(el.getAttribute(a));
const colour = (el: Element): string =>
  el.getAttribute('fill') || (el as SVGElement).style.fill || el.getAttribute('stroke') || (el as SVGElement).style.stroke || '';
const strip = (c: HTMLElement): SVGSVGElement => c.querySelector('svg.dist-strip') as SVGSVGElement;
const geometry = (svg: SVGSVGElement) => {
  const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const n = Number(svg.getAttribute('data-cells'));
  return { cell: w! / n, h: h!, n };
};
const baseline = (svg: SVGSVGElement): number => Math.max(...[...svg.querySelectorAll('rect.bar')].map((r) => num(r, 'y') + num(r, 'height')));

/** A 20-place pmf with a peak at P8 and two empty places. */
const PMF = [0, 0.01, 0.02, 0.04, 0.08, 0.12, 0.16, 0.2, 0.14, 0.1, 0.06, 0.04, 0.02, 0.01, 0, 0, 0, 0, 0, 0];
/** Eight gain bins, −4 … +4 s by 1 s. */
const GAIN = [0.02, 0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.03];

describe('kit/dist', () => {
  it('sharedScale over three pmfs is their largest bin', () => {
    expect(sharedScale([[0.1, 0.3, 0.2], [0.25, 0.05], [0.31, 0.01]])).toBe(0.31);
    expect(sharedScale([[0, 0], [0]])).toBe(1);
    expect(sharedScale([])).toBe(1);
  });

  it('placeBars: 20 cells, heights proportional to scale, a zero bin draws no bar; lit makes every bar ownCar', () => {
    const scale = 0.4;
    const bars = placeBars(PMF, scale, BOX);
    const cell = BOX.w / 20;
    expect(bars).toHaveLength(PMF.filter((p) => p > 0).length);
    const bins = bars.map((b) => Math.floor((b.x + b.w / 2) / cell));
    expect(bins).toEqual(PMF.flatMap((p, i) => (p > 0 ? [i] : [])));
    for (const [k, b] of bars.entries()) {
      const i = bins[k]!;
      expect(b.x).toBeGreaterThanOrEqual(i * cell);
      expect(b.x + b.w).toBeLessThanOrEqual((i + 1) * cell + 1e-9);
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeCloseTo((BOX.h * PMF[i]!) / scale, 9);
      expect(b.role).toBe('text');
    }
    // The same pmf against a larger shared scale stands lower.
    expect(placeBars(PMF, 0.8, BOX).map((b) => b.h)).toEqual(bars.map((b) => b.h / 2));
    expect(placeBars(PMF, scale, BOX, true).every((b) => b.role === 'ownCar')).toBe(true);
  });

  it('gainBars: bars below zero faint; zero between bins draws a full-height line at that edge, zero under a bin a tick under its centre', () => {
    const cell = BOX.w / GAIN.length;
    const roles = (zero: Parameters<typeof gainBars>[3], lit?: boolean) => gainBars(GAIN, 0.3, BOX, zero, lit).map((b) => b.role);
    expect(roles({ between: 4 })).toEqual(['textFaint', 'textFaint', 'textFaint', 'textFaint', 'textDim', 'textDim', 'textDim', 'textDim']);
    expect(roles({ underBin: 3 })).toEqual(['textFaint', 'textFaint', 'textFaint', 'textDim', 'textDim', 'textDim', 'textDim', 'textDim']);
    expect(roles({ between: 4 }, true).every((r) => r === 'ownCar')).toBe(true);
    for (const [i, b] of gainBars(GAIN, 0.3, BOX, { between: 4 }).entries()) {
      expect(b.x).toBeGreaterThanOrEqual(i * cell);
      expect(b.h).toBeCloseTo((BOX.h * GAIN[i]!) / 0.3, 9);
    }

    const between = strip(render(DistStrip, { form: 'gain', bins: GAIN, scale: 0.3, zero: { between: 4 } }).container);
    const g1 = geometry(between);
    const line = between.querySelector('line.zero')!;
    expect(line.getAttribute('data-zero')).toBe('between');
    expect(num(line, 'x1')).toBeCloseTo(4 * g1.cell, 6);
    expect(num(line, 'x2')).toBeCloseTo(4 * g1.cell, 6);
    expect(Math.abs(num(line, 'y2') - num(line, 'y1'))).toBeGreaterThanOrEqual(0.8 * g1.h);
    expect(colour(line)).toBe(role('text'));
    expect([...between.querySelectorAll('rect.bar')].map(colour)).toEqual(roles({ between: 4 }).map((r) => role(r)));
    cleanup();

    const under = strip(render(DistStrip, { form: 'gain', bins: GAIN, scale: 0.3, zero: { underBin: 3 } }).container);
    const g2 = geometry(under);
    const tick = under.querySelector('line.zero')!;
    expect(tick.getAttribute('data-zero')).toBe('under');
    expect(num(tick, 'x1')).toBeCloseTo(3.5 * g2.cell, 6);
    expect(Math.min(num(tick, 'y1'), num(tick, 'y2'))).toBeGreaterThanOrEqual(baseline(under) - 1e-6);
    expect(colour(tick)).toBe(role('text'));
  });

  it('a mark at 6.2 bins is drawn dotted between cells 6 and 7', () => {
    const svg = strip(render(DistStrip, { form: 'gain', bins: GAIN, scale: 0.3, zero: { between: 4 }, markAtBin: 6.2 }).container);
    const { cell } = geometry(svg);
    const mark = svg.querySelector('line.mark')!;
    expect(num(mark, 'x1')).toBeCloseTo(6.2 * cell, 6);
    expect(num(mark, 'x2')).toBeCloseTo(6.2 * cell, 6);
    expect(num(mark, 'x1')).toBeGreaterThan(6 * cell);
    expect(num(mark, 'x1')).toBeLessThan(7 * cell);
    expect(mark.getAttribute('stroke-dasharray') || (mark as SVGElement).style.strokeDasharray).toBeTruthy();
    expect(colour(mark)).toBe(role('ownCar'));
    cleanup();
    const plain = strip(render(DistStrip, { form: 'gain', bins: GAIN, scale: 0.3, zero: { between: 4 } }).container);
    expect(plain.querySelector('line.mark')).toBeNull();
  });

  it('DistStrip renders the underline under ourPlace', () => {
    const svg = strip(render(DistStrip, { form: 'places', pmf: PMF, scale: 0.2, ourPlace: 8 }).container);
    expect(svg.getAttribute('data-form')).toBe('places');
    const { cell, n } = geometry(svg);
    expect(n).toBe(20);
    expect(svg.querySelectorAll('rect.bar')).toHaveLength(PMF.filter((p) => p > 0).length);
    const line = svg.querySelector('rect.our-place')!;
    expect(num(line, 'x')).toBeCloseTo(7 * cell, 6);
    expect(num(line, 'width')).toBeCloseTo(cell, 6);
    expect(num(line, 'y')).toBeGreaterThanOrEqual(baseline(svg) - 1e-6);
    expect(colour(line)).toBe(role('text'));
    expect([...svg.querySelectorAll('rect.bar')].every((r) => colour(r) === role('text'))).toBe(true);
    cleanup();
    const lit = strip(render(DistStrip, { form: 'places', pmf: PMF, scale: 0.2, lit: true }).container);
    expect(lit.querySelector('rect.our-place')).toBeNull();
    expect([...lit.querySelectorAll('rect.bar')].every((r) => colour(r) === role('ownCar'))).toBe(true);
  });
});
