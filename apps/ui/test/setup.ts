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

// The chart is a lazy import (uPlot and its CSS); a gallery test can end before it resolves, and a load after the
// environment is torn down is an unhandled error. Loading it once here puts it in the module cache first.
await import('../src/kit/chart/Chart.svelte');
