// @vitest-environment jsdom
// The distribution strip in the kit gallery (SP4.3b2 Task 3, row 8). Contract assumed of `src/gallery/KitParts.svelte`:
// a cell `[data-gallery-id="kit/dist"]` with `data-ready` holding `kit/dist/DistStrip.svelte` strips (`svg.dist-strip`, the
// DOM contract in `dist.test.ts`): a places strip with our place underlined, a gain strip with its zero between bins
// (`line.zero[data-zero="between"]`) and a dotted mark, a gain strip with its zero under a bin (`data-zero="under"`),
// and a lit strip (every bar in the `ownCar` role). Like every kit part, no screenshot baseline of its own.
import { cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KitParts from '../../src/gallery/KitParts.svelte';
import { role } from '../../src/theme/index.ts';
import { renderReady } from '../gallery/render-ready.ts';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {}, matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASELINES = Object.keys(import.meta.glob('../../e2e/__screenshots__/*.png'));
const colour = (el: Element): string => el.getAttribute('fill') || (el as SVGElement).style.fill || '';

describe('gallery: the distribution strip', () => {
  it('the kit gallery shows the strip in both forms, both zero styles and lit, without a baseline', async () => {
    const { container } = await renderReady(KitParts);
    const cell = container.querySelector('[data-gallery-id="kit/dist"]');
    expect(cell).not.toBeNull();
    expect(cell!.hasAttribute('data-ready')).toBe(true);
    const strips = [...cell!.querySelectorAll('svg.dist-strip')];
    expect(strips.some((s) => s.getAttribute('data-form') === 'places' && s.querySelector('rect.our-place') !== null)).toBe(true);
    const gain = strips.filter((s) => s.getAttribute('data-form') === 'gain');
    expect(gain.some((s) => s.querySelector('line.zero[data-zero="between"]') !== null && s.querySelector('line.mark') !== null)).toBe(true);
    expect(gain.some((s) => s.querySelector('line.zero[data-zero="under"]') !== null)).toBe(true);
    const lit = strips.filter((s) => {
      const bars = [...s.querySelectorAll('rect.bar')];
      return bars.length > 0 && bars.every((b) => colour(b) === role('ownCar'));
    });
    expect(lit.length).toBeGreaterThanOrEqual(1);
    expect(BASELINES.filter((p) => /kit|dist/i.test(p.split('/').pop() ?? ''))).toEqual([]);
  });
});
