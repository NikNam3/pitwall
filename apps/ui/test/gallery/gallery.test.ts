// @vitest-environment jsdom
// The gallery (spec 9.2, Task 21). Contract assumed of `apps/ui/src/gallery/Gallery.svelte`:
//  - prop `moments?: Record<string, MomentValues>` (moment name -> values); default: every file of
//    `test-support/moments/` by name (`import.meta.glob`). The test passes its own, so no recording is needed;
//  - it renders the real `WIDGETS` (`widgets/index.generated.ts`) with each widget's `gallery.ts` (`import.meta.glob`);
//  - widget section: one element per cell with `data-gallery-id="<widget>/<mode>/<moment-or-case>/<theme>"` where
//    - `<mode>` is a size mode name (the cell is that mode's minimum) or, for a `fit` entry that is not a mode's
//      minimum, `<mode>-<cols>x<rows>`;
//    - `<theme>` is the `ThemeVariant.name` of each of `THEMES`;
//    - each cell holds a real `Panel` (a `<header>` with the widget's title);
//  - frame section: elements `data-gallery-id="frame/<state>"` for `noData`, `errored`, `stale`, `computed`,
//    `unknownWidget`; kit section: at least one element `data-gallery-id` starting with `kit/`;
//  - a ResizeObserver exists (stubbed below to 600 x 400 px); ids are unique.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomentValues } from '../../src/gallery/moment-values.ts';
import Gallery from '../../src/gallery/Gallery.svelte';
import { THEMES } from '../../src/theme/index.ts';
import gallery from '../../src/widgets/feed-status/gallery.ts';
import { widget } from '../../src/widgets/feed-status/widget.ts';

// Each test renders the whole gallery (every widget, case and size), which takes seconds, more under load.
vi.setConfig({ testTimeout: 30_000 });

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

const feedStatus = { feedId: 'gallery', connected: true, stale: false, lossPercent: 0, latePackets: 0, decodeErrors: 0, packetsPerSecond: 60, cadenceMs: 100 };
const momentValues: MomentValues = [{ topic: 'feed.status', params: {}, value: feedStatus }];
const moments = Object.fromEntries(gallery.moments.map((name) => [name, momentValues]));

/** The ids the gallery owes `feed-status`, from its widget sizes, gallery entry and the themes. */
function expectedIds(): string[] {
  const minimums = Object.entries(widget.sizes).map(([mode, s]) => ({ mode: `${mode}`, cols: s.minCols, rows: s.minRows }));
  const sizes = [
    ...minimums.map((m) => m.mode),
    ...(gallery.fit ?? [])
      .filter((f) => !minimums.some((m) => m.mode === f.mode && m.cols === f.cols && m.rows === f.rows))
      .map((f) => `${f.mode}-${f.cols}x${f.rows}`),
  ];
  const data = [...gallery.moments, ...Object.keys(gallery.cases ?? {})];
  return sizes.flatMap((size) => data.flatMap((d) => THEMES.map((t) => `feed-status/${size}/${d}/${t.name}`)));
}

describe('Gallery', () => {
  it('renders one cell per expected data-gallery-id for feed-status, each once', () => {
    const { container } = render(Gallery, { moments });
    const ids = [...container.querySelectorAll('[data-gallery-id^="feed-status/"]')].map((e) => e.getAttribute('data-gallery-id')!);
    expect(expectedIds().length).toBe(5 * 6 * THEMES.length);
    expect([...ids].sort()).toEqual([...expectedIds()].sort());
  });

  it('puts a real Panel in each widget cell', () => {
    const { container } = render(Gallery, { moments });
    const cells = container.querySelectorAll('[data-gallery-id^="feed-status/"]');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.querySelector('header')?.textContent).toContain(widget.title);
  });

  it('shows the panel frame in every state and the kit parts', () => {
    const { container } = render(Gallery, { moments });
    const ids = [...container.querySelectorAll('[data-gallery-id]')].map((e) => e.getAttribute('data-gallery-id')!);
    for (const state of ['noData', 'errored', 'stale', 'computed', 'unknownWidget']) expect(ids).toContain(`frame/${state}`);
    expect(ids.some((id) => id.startsWith('kit/'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
