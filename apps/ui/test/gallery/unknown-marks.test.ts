// @vitest-environment jsdom
// An unknown value shows a faint short mark for its reason, never an empty cell (user ruling 2026-10-30, Task P); the
// reason stays on hover. Checked on every widget's synthetic gallery cases, at each size mode's minimum, default theme.
// Contract assumed:
//  - `unknownMark` in `kit/text.ts` holds the mark of each `UnknownReason`, next to `unknownReason` (the hover texts);
//  - a display hovers the reason of an unknown value on an element whose `title` is `unknownReason[reason]`; that element,
//    or an element inside it, holds exactly the reason's mark as its text (whitespace padding aside) with the inline colour
//    `role('textFaint')`; a composite cell (a line, a list of car codes) holds the mark of the part that is unknown;
//  - the kit `Bar` (class `bar`) draws an unknown value as empty cells and is not a text cell: it and its wrapper are skipped.
import { cleanup, render } from '@testing-library/svelte';
import type { UnknownReason } from '@pitwall/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GalleryCell from '../../src/gallery/GalleryCell.svelte';
import type { GalleryOverride } from '../../src/gallery/gallery-connection.ts';
import { cellBox } from '../../src/kit/size/size.ts';
import { unknownMark, unknownReason } from '../../src/kit/text.ts';
import type { RegisteredWidget } from '../../src/kit/types.ts';
import { DEFAULT_THEME, role } from '../../src/theme/index.ts';

// jsdom has no canvas: the gap chart's plot is a no-op here (its reference line is text).
vi.mock('uplot', () => ({
  default: class {
    setSize() {}
    setData() {}
    destroy() {}
  },
}));

// Every widget by its register file (only the shell imports the generated index), and its gallery declaration.
const registered = import.meta.glob<{ default: RegisteredWidget }>('../../src/widgets/*/register.ts', { eager: true });
const WIDGETS = Object.values(registered).map((m) => m.default);
type Declared = { cases?: Record<string, Record<string, unknown>> };
const files = import.meta.glob<{ default: Declared }>('../../src/widgets/*/gallery.ts', { eager: true });
const casesOf = (name: string): Record<string, Record<string, unknown>> => files[`../../src/widgets/${name}/gallery.ts`]?.default.cases ?? {};

/** The overrides of a case, as the gallery builds them: each data key names the topic it replaces. */
const overridesOf = (w: RegisteredWidget, values: Record<string, unknown>): GalleryOverride[] => {
  const data = w.decl.data as Record<string, { topic: GalleryOverride['topic'] }>;
  return Object.entries(values).flatMap(([key, value]) => (data[key] === undefined ? [] : [{ topic: data[key].topic, value }]));
};

// The panel measures its body with a ResizeObserver: report the box of the size under test.
const box = cellBox(DEFAULT_THEME.fontPx, DEFAULT_THEME.density.lineHeight);
let px = { width: 0, height: 0 };
vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {}, matches: false }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    private readonly cb: (entries: unknown[]) => void;
    constructor(cb: (entries: unknown[]) => void) {
      this.cb = cb;
    }
    observe() {
      this.cb([{ contentRect: px }]);
    }
    disconnect() {}
  },
);
afterEach(cleanup);

const REASON_OF_TITLE = new Map<string, UnknownReason>(Object.entries(unknownReason).map(([reason, title]) => [title, reason as UnknownReason]));
const FAINT = role('textFaint');

/** One element that hovers an unknown reason, where it was seen. */
type Hover = { at: string; reason: UnknownReason; text: string; marked: boolean };

/** The element, or one inside it, shows exactly the reason's mark in the faint role. */
const hasFaintMark = (el: HTMLElement, reason: UnknownReason): boolean =>
  [el, ...el.querySelectorAll<HTMLElement>('*')].some((e) => e.textContent?.trim() === unknownMark[reason] && e.style.color === FAINT);

const isBar = (el: HTMLElement): boolean => el.matches('.bar') || el.querySelector('.bar') !== null;

/** Every reason hover of the widget's cases at each mode's minimum. */
async function scan(w: RegisteredWidget): Promise<Hover[]> {
  await w.component();
  const hovers: Hover[] = [];
  for (const [mode, s] of Object.entries(w.decl.sizes)) {
    px = { width: s.minCols * box.width + 0.5, height: s.minRows * box.height + 0.5 };
    for (const [name, values] of Object.entries(casesOf(w.decl.name))) {
      const { container, unmount } = render(GalleryCell, {
        id: `${w.decl.name}/${mode}/${name}`, theme: DEFAULT_THEME, widget: w, widgetName: w.decl.name,
        cols: s.minCols, rows: s.minRows, moment: [], overrides: overridesOf(w, values),
      });
      // The subscriptions answer on a microtask and the view renders on the next ones: a macrotask sees them all done.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      for (const el of container.querySelectorAll<HTMLElement>('[title]')) {
        const reason = REASON_OF_TITLE.get(el.getAttribute('title') ?? '');
        if (reason === undefined || isBar(el)) continue;
        hovers.push({ at: `${mode}/${name}`, reason, text: el.textContent ?? '', marked: hasFaintMark(el, reason) });
      }
      unmount();
    }
  }
  return hovers;
}

const scans = new Map<string, Promise<Hover[]>>();
const hoversOf = (w: RegisteredWidget): Promise<Hover[]> => {
  if (!scans.has(w.decl.name)) scans.set(w.decl.name, scan(w));
  return scans.get(w.decl.name)!;
};
const widgetNamed = (name: string): RegisteredWidget => WIDGETS.find((w) => w.decl.name === name)!;

describe('unknown marks: every display', () => {
  it.each(WIDGETS.map((w) => [w.decl.name, w] as const))('%s: every reason hover shows its mark in the faint role', async (_name, w) => {
    const unmarked = (await hoversOf(w)).filter((h) => !h.marked).map(({ at, reason, text }) => ({ at, reason, text }));
    expect(unmarked).toEqual([]);
  });

  // The reasons each display's gallery cases hover today (2026-10-30): the change keeps every one of them. A display may
  // hover more reasons than these, never fewer.
  const HOVERED: Record<string, UnknownReason[]> = {
    'battle-cards': ['notApplicable', 'realism'],
    'corner-block': ['insufficientData', 'notApplicable', 'realism'],
    'damage-card': ['realism'],
    'ers-budget': ['realism'],
    'feed-status': ['notReceived'],
    'fuel-gauge': ['insufficientData', 'notApplicable', 'realism'],
    'gap-chart': ['insufficientData'],
    'incident-feed': ['insufficientData', 'notApplicable', 'notReceived'],
    'lap-analysis': ['notReceived', 'realism'],
    'projected-lap': ['notApplicable'],
    'timing-tower': ['notApplicable', 'notReceived', 'realism'],
    'tyre-life-bar': ['insufficientData', 'realism'],
  };
  it.each(Object.entries(HOVERED))('%s: still hovers the reasons of its unknown values', async (name, reasons) => {
    const hovered = new Set((await hoversOf(widgetNamed(name))).map((h) => h.reason));
    expect([...hovered].sort()).toEqual(expect.arrayContaining(reasons));
  });
});
