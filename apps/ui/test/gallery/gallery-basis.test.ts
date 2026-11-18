// @vitest-environment jsdom
// SP4.3e Task 7c-2: the basis and plan picker's gallery cells (spec §4.2; C69, few baselines). Contract assumed:
//  - `SHELL_CELLS` (`gallery/cells.ts`) holds one `basis-picker` cell per `BASIS_CASES` name (`gallery/basis-cases.ts`),
//    in its order, id `shell/basis-picker/<name>`; only the first has a baseline (the picker's one misc baseline), and
//    the top bar's `basis-none` and `basis-laps-differ` cells have none;
//  - the gallery (`ShellCells.svelte`) draws each picker cell as the real picker overlay on a `GalleryConnection` with
//    the case's overrides: a `data-gallery-id` figure, `data-ready` once drawn, holding `[data-testid="basis-picker"]`.
// Fails until `ShellCells.svelte` draws the picker (implementation).
import { mount, unmount } from 'svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BASIS_CASES } from '../../src/gallery/basis-cases.ts';
import { SHELL_CELLS } from '../../src/gallery/cells.ts';
import type { MomentValues } from '../../src/gallery/moment-values.ts';
import Gallery from '../../src/gallery/Gallery.svelte';
import gallery from '../../src/widgets/feed-status/gallery.ts';
import { untilReady } from './render-ready.ts';

const NAMES = Object.keys(BASIS_CASES);

describe('the picker\'s shell cells', () => {
  it('one basis-picker cell per case, in order; only the first has a baseline', () => {
    const cells = SHELL_CELLS.filter((c) => c.kind === 'basis-picker');
    expect(NAMES).toEqual(['own-weekend', 'none', 'last-choice', 'rebuilding', 'laps-differ']);
    expect(cells.map((c) => c.id)).toEqual(NAMES.map((n) => `shell/basis-picker/${n}`));
    expect(cells.map((c) => c.detail)).toEqual(NAMES);
    expect(cells.map((c) => c.hasBaseline)).toEqual([true, false, false, false, false]);
    for (const id of ['shell/topbar/basis-none', 'shell/topbar/basis-laps-differ']) expect(SHELL_CELLS.find((c) => c.id === id)?.hasBaseline).toBe(false);
  });
});

const feedStatus = { feedId: 'gallery', connected: true, stale: false, lossPercent: 0, latePackets: 0, decodeErrors: 0, packetsPerSecond: 60, cadenceMs: 100 };
const momentValues: MomentValues = [{ topic: 'feed.status', params: {}, value: feedStatus }];
const moments = Object.fromEntries(gallery.moments.map((name) => [name, momentValues]));

let shown: { container: HTMLElement; app: ReturnType<typeof mount> } | undefined;
beforeAll(async () => {
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
  const container = document.body.appendChild(document.createElement('div'));
  shown = { container, app: mount(Gallery, { target: container, props: { moments, widgets: ['feed-status'] } }) };
  await untilReady(container);
});
afterAll(async () => {
  if (shown !== undefined) {
    await unmount(shown.app);
    shown.container.remove();
  }
  vi.unstubAllGlobals();
});

const cell = (name: string): HTMLElement | null => shown?.container.querySelector<HTMLElement>(`[data-gallery-id="shell/basis-picker/${name}"]`) ?? null;
const textOf = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the gallery draws the picker', () => {
  it.each(NAMES)('%s: a ready cell holding the picker', (name) => {
    const figure = cell(name);
    expect(figure).not.toBeNull();
    expect(figure!.hasAttribute('data-ready')).toBe(true);
    expect(figure!.querySelector('[data-testid="basis-picker"]')).not.toBeNull();
  });

  it('own weekend: both practices and the qualifying of the weekend chosen, the morning\'s plan', () => {
    const picker = cell('own-weekend')!;
    expect((picker.querySelector('[data-testid="practice-4011121896695002375@548397152"]') as HTMLInputElement | null)?.checked).toBe(true);
    expect((picker.querySelector('[data-testid="practice-5022233344455566677@548397152"]') as HTMLInputElement | null)?.checked).toBe(true);
    expect((picker.querySelector('[data-testid="qualifying-12101553556244014932@548397152"]') as HTMLInputElement | null)?.checked).toBe(true);
    expect((picker.querySelector('[data-testid="plan-plan-texas-1809"]') as HTMLInputElement | null)?.checked).toBe(true);
  });

  it('none: every kind none', () => {
    const picker = cell('none')!;
    for (const id of ['practice-none', 'qualifying-none', 'plan-none']) expect((picker.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null)?.checked, id).toBe(true);
  });

  it('last choice: marked', () => {
    expect(textOf(cell('last-choice'))).toContain('last choice');
  });

  it('rebuilding: the progress line', () => {
    expect(textOf(cell('rebuilding')?.querySelector('[data-testid="basis-progress"]'))).toBe('rebuilding 1 / 3');
  });
});
