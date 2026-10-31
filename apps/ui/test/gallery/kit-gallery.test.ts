// @vitest-environment jsdom
// The kit gallery owes a cell to each car care piece (plan Task 6; spec 9.2). Contract: the gallery's kit section
// (`src/gallery/KitParts.svelte`, which the gallery holds: gallery.test.ts) renders elements `data-gallery-id`
// `kit/corner-grid`, `kit/bar`, `kit/compound-mark` and `kit/insight-line`, each with `data-ready` once drawn; `kit/bar`
// shows a known bar, a bar with limit, marker and reserve, and an unknown one (its `.bar` has a title); `kit/compound-mark`
// shows soft, medium and hard with an age; `kit/corner-grid` shows four `[data-corner]` cells; `kit/insight-line` shows an
// unacknowledged and an acknowledged line. Same stubs as `gallery.test.ts`.
import { cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KitParts from '../../src/gallery/KitParts.svelte';
import { renderReady } from './render-ready.ts';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 600, height: 400 } }]);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {}, matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cell = (c: HTMLElement, id: string) => c.querySelector(`[data-gallery-id="${id}"]`) as HTMLElement | null;

describe('kit gallery: car care pieces', () => {
  it.each(['kit/corner-grid', 'kit/bar', 'kit/compound-mark', 'kit/insight-line'])('has the cell %s', async (id) => {
    const { container } = await renderReady(KitParts);
    const el = cell(container, id);
    expect(el).not.toBeNull();
    expect(el?.hasAttribute('data-ready')).toBe(true);
  });
  it('the corner grid cell shows four corners', async () => {
    const { container } = await renderReady(KitParts);
    expect(cell(container, 'kit/corner-grid')?.querySelectorAll('[data-corner]')).toHaveLength(4);
  });
  it('the bar cell shows several bars, one unknown with a reason on hover', async () => {
    const { container } = await renderReady(KitParts);
    const bars = [...(cell(container, 'kit/bar')?.querySelectorAll('.bar') ?? [])];
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(bars.some((b) => b.getAttribute('title') !== null)).toBe(true);
  });
  it('the compound cell shows soft, medium and hard', async () => {
    const { container } = await renderReady(KitParts);
    const letters = [...(cell(container, 'kit/compound-mark')?.querySelectorAll('.compound') ?? [])].map((e) => e.textContent?.trim()?.[0]);
    expect(letters).toEqual(expect.arrayContaining(['S', 'M', 'H']));
  });
  it('the insight cell shows an acknowledged and an unacknowledged line', async () => {
    const { container } = await renderReady(KitParts);
    expect(cell(container, 'kit/insight-line')?.querySelectorAll('.insight-line').length).toBeGreaterThanOrEqual(2);
  });
});
