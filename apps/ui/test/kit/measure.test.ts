// @vitest-environment jsdom
// The kit's `measure` action (spec 4.4): the size comes from the ResizeObserver, and applying the action reads no
// layout. The gallery mounts about two thousand panels in one go; a layout read per mount forced a layout per panel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measure, type Measured } from '../../src/kit/size/measure.ts';

type Observed = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
let observed: Observed | undefined;
let dprChange: (() => void) | undefined;

function stubs(): void {
  observed = undefined;
  dprChange = undefined;
  vi.stubGlobal('ResizeObserver', class { constructor(cb: Observed) { observed = cb; } observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ addEventListener: (_: string, cb: () => void) => (dprChange = cb), removeEventListener() {}, matches: false }));
}
afterEach(() => vi.unstubAllGlobals());

/** A node whose layout reads are counted: 120 x 40 px with 2 px of padding on each side. */
function node(): { el: HTMLElement; reads: () => number } {
  const el = document.createElement('div');
  el.style.padding = '2px';
  let reads = 0;
  Object.defineProperty(el, 'clientWidth', { get: () => (reads++, 124) });
  Object.defineProperty(el, 'clientHeight', { get: () => (reads++, 44) });
  return { el, reads: () => reads };
}

describe('measure', () => {
  it('reads no layout when it is applied, and reports the size the observer gives', () => {
    stubs();
    const { el, reads } = node();
    const seen: Measured[] = [];
    measure(el, (m) => seen.push(m));
    expect(reads()).toBe(0);
    expect(seen).toEqual([]);
    observed!([{ contentRect: { width: 300, height: 90 } }]);
    expect(seen).toEqual([{ px: { width: 300, height: 90 }, dpr: window.devicePixelRatio }]);
    expect(reads()).toBe(0);
  });

  it('a pixel ratio change before the first observation reports the content box, read then', () => {
    stubs();
    const { el, reads } = node();
    const seen: Measured[] = [];
    measure(el, (m) => seen.push(m));
    dprChange!();
    expect(seen).toEqual([{ px: { width: 120, height: 40 }, dpr: window.devicePixelRatio }]);
    expect(reads()).toBeGreaterThan(0);
  });

  it('a pixel ratio change after an observation reports the observed size', () => {
    stubs();
    const { el } = node();
    const seen: Measured[] = [];
    measure(el, (m) => seen.push(m));
    observed!([{ contentRect: { width: 300, height: 90 } }]);
    dprChange!();
    expect(seen.at(-1)).toEqual({ px: { width: 300, height: 90 }, dpr: window.devicePixelRatio });
  });
});
