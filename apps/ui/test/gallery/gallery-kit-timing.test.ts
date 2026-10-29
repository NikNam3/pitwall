// @vitest-environment jsdom
// Gallery cells of the timing kit pieces (spec 8.4, 9.2). Contract assumed of `src/gallery/KitParts.svelte`:
// it renders one element per piece with `data-gallery-id` `kit/car-label`, `kit/position-mark`, `kit/chart-bands`
// and `kit/sector-status`, each with the `data-ready` attribute (the chart cell once it has drawn).
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KitParts from '../../src/gallery/KitParts.svelte';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {}, matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('gallery: timing kit pieces', () => {
  it.each(['kit/car-label', 'kit/position-mark', 'kit/chart-bands', 'kit/sector-status'])('has a cell %s', (id) => {
    const { container } = render(KitParts);
    expect(container.querySelector(`[data-gallery-id="${id}"]`)).not.toBeNull();
  });
  it('the position mark cell shows the gained, lost and pair forms', () => {
    const { container } = render(KitParts);
    const text = container.querySelector('[data-gallery-id="kit/position-mark"]')?.textContent ?? '';
    expect(text).toContain('▲');
    expect(text).toContain('▼');
    expect(text).toContain('→');
  });
});
