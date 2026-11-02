import { afterEach, vi } from 'vitest';
import { installCanvas2d } from './canvas-2d.ts';

// jsdom has no 2D context; the charts get the inert one a browser would give without pixels (canvas-2d.ts).
installCanvas2d();

// The test DOM has no `matchMedia`; uPlot calls it when a chart loads and while it draws, which can be after a test
// has ended (the gallery loads charts lazily). A permanent inert one keeps those late calls from throwing.
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
}

// The gallery loads widgets and the chart lazily; a test can end before those imports resolve, and a load after the
// environment is torn down is an unhandled error. Each test waits for its dynamic imports to settle.
afterEach(async () => {
  await vi.dynamicImportSettled();
});
