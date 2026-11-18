// @vitest-environment jsdom
// SP4.3f Task 10: the name prompt "Save plan"'s gallery cell (spec §4.4; C69, the screenshot budget). Contract assumed:
//  - `SHELL_CELLS` (`gallery/cells.ts`) holds one `plan-save` cell per `PLAN_SAVE_CASES` name
//    (`gallery/plan-save-cases.ts`), in its order, id `shell/plan-save/<name>`, none with a baseline;
//  - the gallery (`ShellCells.svelte`) draws each as the real prompt overlay (`shell/plans/PlanSavePicker.svelte`) on a
//    `GalleryConnection` with the case's overrides: a `data-gallery-id` figure, `data-ready` once drawn, holding
//    `[data-testid="plan-save-picker"]` with its one `overwrite` radio and the name prefilled from the frozen clock.
// Fails until `ShellCells.svelte` draws the prompt (implementation).
import { mount, unmount } from 'svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SHELL_CELLS } from '../../src/gallery/cells.ts';
import type { MomentValues } from '../../src/gallery/moment-values.ts';
import { PLAN_SAVE_CASES } from '../../src/gallery/plan-save-cases.ts';
import Gallery from '../../src/gallery/Gallery.svelte';
import { untilReady } from '../gallery/render-ready.ts';

const NAMES = Object.keys(PLAN_SAVE_CASES);

describe('the prompt\'s shell cells', () => {
  it('one plan-save cell per case, in order, none with a baseline', () => {
    const cells = SHELL_CELLS.filter((c) => c.kind === 'plan-save');
    expect(NAMES).toEqual(['one-saved']);
    expect(cells.map((c) => c.id)).toEqual(NAMES.map((n) => `shell/plan-save/${n}`));
    expect(cells.map((c) => c.detail)).toEqual(NAMES);
    expect(cells.map((c) => c.hasBaseline)).toEqual([false]);
  });
});

/** No widget section and no moment: the shell cells are always drawn, and the prompt needs only its case's overrides. */
const moments: Record<string, MomentValues> = {};

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
  shown = { container, app: mount(Gallery, { target: container, props: { moments, widgets: [] } }) };
  await untilReady(container);
});
afterAll(async () => {
  if (shown !== undefined) {
    await unmount(shown.app);
    shown.container.remove();
  }
  vi.unstubAllGlobals();
});

const cell = (name: string): HTMLElement | null => shown?.container.querySelector<HTMLElement>(`[data-gallery-id="shell/plan-save/${name}"]`) ?? null;
const textOf = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the gallery draws the prompt', () => {
  it('one-saved: a ready cell holding the prompt, the name prefilled on Texas, one overwrite radio', () => {
    const figure = cell('one-saved');
    expect(figure).not.toBeNull();
    expect(figure!.hasAttribute('data-ready')).toBe(true);
    const prompt = figure!.querySelector('[data-testid="plan-save-picker"]');
    expect(prompt).not.toBeNull();
    const name = prompt!.querySelector<HTMLInputElement>('[data-testid="plan-save-name"]');
    expect(name?.value).toMatch(/^Texas .+ 12:00$/);
    const radios = [...prompt!.querySelectorAll('[data-testid^="plan-save-replaces-"]')];
    expect(radios.map((r) => r.getAttribute('data-testid'))).toEqual(['plan-save-replaces-plan-texas-1809']);
    expect(textOf(radios[0]!.closest('label'))).toBe('overwrite Texas 18 Nov 09:40');
  });
});
