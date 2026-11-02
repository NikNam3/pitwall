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
//    `unknownWidget`; kit section: exactly the cells of `KIT_IDS` below, each `data-ready` once drawn (review 8, R8-4:
//    every kit cell is read in the gallery itself, not in the kit section rendered alone);
//  - the car care pieces of the kit section (plan Task 6): `kit/bar` shows a known bar, a bar with limit, marker and
//    reserve, and an unknown one (its `.bar` has a title); `kit/compound-mark` shows soft, medium and hard with an age;
//    `kit/corner-grid` shows four `[data-corner]` cells; `kit/insight-line` an unacknowledged and an acknowledged line;
//  - a ResizeObserver exists (stubbed below to 600 x 400 px); ids are unique.
import { mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomentValues } from '../../src/gallery/moment-values.ts';
import Gallery from '../../src/gallery/Gallery.svelte';
import { THEMES } from '../../src/theme/index.ts';
import gallery from '../../src/widgets/feed-status/gallery.ts';
import { widget } from '../../src/widgets/feed-status/widget.ts';
import { untilReady } from './render-ready.ts';

// The first test renders the whole gallery (every widget, case and size) and waits until every cell is ready: seconds,
// more under load.
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

/** Every cell the gallery's kit section owes: one per kit part it shows. */
const KIT_IDS = [
  'kit/value', 'kit/icon', 'kit/table', 'kit/corner-grid', 'kit/bar', 'kit/compound-mark', 'kit/insight-line', 'kit/chart',
  'kit/chart-bands', 'kit/car-label', 'kit/position-mark', 'kit/sector-status',
] as const;
const kitCell = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-gallery-id="${id}"]`);

// The tests only read the gallery: the first one that needs it renders it, it is unmounted after the last. One render
// per file, the kit cells included (review 8, R8-4), since a whole gallery takes seconds to render.
let shown: { container: HTMLElement; app: ReturnType<typeof mount>; ready: Promise<void> } | undefined;
async function shownGallery(): Promise<HTMLElement> {
  if (shown === undefined) {
    const container = document.body.appendChild(document.createElement('div'));
    shown = { container, app: mount(Gallery, { target: container, props: { moments } }), ready: untilReady(container) };
  }
  await shown.ready;
  return shown.container;
}
afterAll(async () => {
  if (shown === undefined) return;
  await unmount(shown.app);
  shown.container.remove();
});

describe('Gallery', () => {
  it('renders one cell per expected data-gallery-id for feed-status, each once', async () => {
    const container = await shownGallery();
    const ids = [...container.querySelectorAll('[data-gallery-id^="feed-status/"]')].map((e) => e.getAttribute('data-gallery-id')!);
    expect(expectedIds().length).toBe(5 * 6 * THEMES.length);
    expect([...ids].sort()).toEqual([...expectedIds()].sort());
  });

  it('puts a real Panel in each widget cell', async () => {
    const container = await shownGallery();
    const cells = container.querySelectorAll('[data-gallery-id^="feed-status/"]');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.querySelector('header')?.textContent).toContain(widget.title);
  });

  it('shows the panel frame in every state and the kit parts', async () => {
    const container = await shownGallery();
    const ids = [...container.querySelectorAll('[data-gallery-id]')].map((e) => e.getAttribute('data-gallery-id')!);
    for (const state of ['noData', 'errored', 'stale', 'computed', 'unknownWidget']) expect(ids).toContain(`frame/${state}`);
    expect(ids.filter((id) => id.startsWith('kit/')).sort()).toEqual([...KIT_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(KIT_IDS)('the kit cell %s is drawn (data-ready)', async (id) => {
    const container = await shownGallery();
    expect(kitCell(container, id)?.hasAttribute('data-ready')).toBe(true);
  });
});

describe('Gallery: the car care pieces of the kit section', () => {
  it('the corner grid cell shows four corners', async () => {
    const container = await shownGallery();
    expect(kitCell(container, 'kit/corner-grid')?.querySelectorAll('[data-corner]')).toHaveLength(4);
  });

  it('the bar cell shows several bars, one unknown with a reason on hover', async () => {
    const container = await shownGallery();
    const bars = [...(kitCell(container, 'kit/bar')?.querySelectorAll('.bar') ?? [])];
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(bars.some((b) => b.getAttribute('title') !== null)).toBe(true);
  });

  it('the compound cell shows soft, medium and hard', async () => {
    const container = await shownGallery();
    const letters = [...(kitCell(container, 'kit/compound-mark')?.querySelectorAll('.compound') ?? [])].map((e) => e.textContent?.trim()?.[0]);
    expect(letters).toEqual(expect.arrayContaining(['S', 'M', 'H']));
  });

  it('the insight cell shows an acknowledged and an unacknowledged line', async () => {
    const container = await shownGallery();
    expect(kitCell(container, 'kit/insight-line')?.querySelectorAll('.insight-line').length).toBeGreaterThanOrEqual(2);
  });
});
