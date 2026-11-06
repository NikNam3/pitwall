// @vitest-environment jsdom
// An unknown value shows a faint short mark for its reason, never an empty cell (user ruling 2026-10-30, Task P); the
// reason stays on hover. Checked on every widget's synthetic gallery cases, default theme.
// Contract assumed:
//  - `unknownMark` in `kit/text.ts` holds the mark of each `UnknownReason`, next to `unknownReason` (the hover texts);
//  - a display hovers the reason of an unknown value on an element whose `title` is `unknownReason[reason]`; that element,
//    or an element inside it, holds exactly the reason's mark as its text (whitespace padding aside) with the inline colour
//    `role('textFaint')`; a composite cell (a line, a list of car codes) holds the mark of the part that is unknown;
//  - the kit `Bar` (class `bar`) draws an unknown value as empty cells and is not a text cell: it and its wrapper are skipped.
// A display that drops an unknown (an empty cell, no title) is found without a list of what the gallery hovers: a value
// whose known form changes the display's text must, when unknown, show one more mark of its reason (wave 2, T7).
import { cleanup, render } from '@testing-library/svelte';
import type { Known, UnknownReason } from '@pitwall/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GalleryCell from '../../src/gallery/GalleryCell.svelte';
import type { GalleryOverride } from '../../src/gallery/gallery-connection.ts';
import { cellBox } from '../../src/kit/size/size.ts';
import { unknownMark, unknownReason } from '../../src/kit/text.ts';
import type { RegisteredWidget } from '../../src/kit/types.ts';
import { DEFAULT_THEME, role } from '../../src/theme/index.ts';

// Every widget by its register file (only the shell imports the generated index), and its gallery declaration.
const registered = import.meta.glob<{ default: RegisteredWidget }>('../../src/widgets/*/register.ts', { eager: true });
const WIDGETS = Object.values(registered).map((m) => m.default);
type Case = Record<string, unknown>;
type Size = { mode: string; cols: number; rows: number };
type Declared = { cases?: Record<string, Case>; fit?: Size[] };
const files = import.meta.glob<{ default: Declared }>('../../src/widgets/*/gallery.ts', { eager: true });
const declared = (name: string): Declared => files[`../../src/widgets/${name}/gallery.ts`]?.default ?? {};
const casesOf = (name: string): Record<string, Case> => declared(name).cases ?? {};

/** The overrides of a case, as the gallery builds them: each data key names the topic it replaces. */
const overridesOf = (w: RegisteredWidget, values: Case): GalleryOverride[] => {
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

/** Renders one case of the widget at `size` and reads the rendered cell before it goes. */
async function rendered<T>(w: RegisteredWidget, name: string, values: Case, size: Size, read: (container: HTMLElement) => T): Promise<T> {
  await w.component();
  px = { width: size.cols * box.width + 0.5, height: size.rows * box.height + 0.5 };
  const { container, unmount } = render(GalleryCell, {
    id: `${w.decl.name}/${size.mode}/${name}`, theme: DEFAULT_THEME, widget: w, widgetName: w.decl.name,
    cols: size.cols, rows: size.rows, moment: [], overrides: overridesOf(w, values),
  });
  // The subscriptions answer on a microtask and the view renders on the next ones: a macrotask sees them all done.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const result = read(container);
  unmount();
  return result;
}

/** One element that hovers an unknown reason, where it was seen. */
type Hover = { at: string; reason: UnknownReason; text: string; marked: boolean };

/** The element shows exactly the reason's mark in the faint role. */
const isFaintMark = (e: Element, reason: UnknownReason): boolean =>
  e.textContent?.trim() === unknownMark[reason] && (e as HTMLElement).style.color === FAINT;

/** The element, or one inside it, shows exactly the reason's mark in the faint role. */
const hasFaintMark = (el: HTMLElement, reason: UnknownReason): boolean =>
  [el, ...el.querySelectorAll('*')].some((e) => isFaintMark(e, reason));

const isBar = (el: HTMLElement): boolean => el.matches('.bar') || el.querySelector('.bar') !== null;

/** Every reason hover of the widget's cases at each mode's minimum. */
async function scan(w: RegisteredWidget): Promise<Hover[]> {
  const hovers: Hover[] = [];
  for (const [mode, s] of Object.entries(w.decl.sizes)) {
    for (const [name, values] of Object.entries(casesOf(w.decl.name))) {
      const found = await rendered(w, name, values, { mode, cols: s.minCols, rows: s.minRows }, (container) =>
        [...container.querySelectorAll<HTMLElement>('[title]')].flatMap((el): Hover[] => {
          const reason = REASON_OF_TITLE.get(el.getAttribute('title') ?? '');
          if (reason === undefined || isBar(el)) return [];
          return [{ at: `${mode}/${name}`, reason, text: el.textContent ?? '', marked: hasFaintMark(el, reason) }];
        }));
      hovers.push(...found);
    }
  }
  return hovers;
}

describe('unknown marks: every display', () => {
  it.each(WIDGETS.map((w) => [w.decl.name, w] as const))('%s: every reason hover shows its mark in the faint role', async (_name, w) => {
    const unmarked = (await scan(w)).filter((h) => !h.marked).map(({ at, reason, text }) => ({ at, reason, text }));
    expect(unmarked).toEqual([]);
  });
});

// ---- an unknown is never dropped: the same value known and unknown ----

type Path = (string | number)[];
/** A `Known` in a case, and where it sits. */
type Leaf = { path: Path; value: Known<unknown> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isKnownValue = (v: unknown): v is Known<unknown> =>
  isRecord(v) && typeof v['known'] === 'boolean' && (v['known'] ? 'value' in v : 'reason' in v);

/** Every `Known` in a value, those inside a known value's value included. */
function leaves(value: unknown, path: Path = []): Leaf[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, i]));
  if (!isRecord(value)) return [];
  if (isKnownValue(value)) return [{ path, value }, ...(value.known ? leaves(value.value, [...path, 'value']) : [])];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
}

/** The place of a value with list positions left out: the same field of every car, row or entry. */
const fieldOf = (path: Path): string => path.map((p) => (typeof p === 'number' ? '*' : p)).join('.');

/** The case with the value at `path` replaced. */
function withValue(values: Case, path: Path, value: unknown): Case {
  const copy = structuredClone(values);
  let at = copy as Record<string | number, unknown>;
  for (const p of path.slice(0, -1)) at = at[p] as Record<string | number, unknown>;
  at[path[path.length - 1]!] = value;
  return copy;
}

/** The widest size the gallery checks the widget at, where it shows the most. */
const widest = (w: RegisteredWidget): Size => {
  const sizes = declared(w.decl.name).fit ?? Object.entries(w.decl.sizes).map(([mode, s]) => ({ mode, cols: s.minCols, rows: s.minRows }));
  return [...sizes].sort((a, b) => b.cols - a.cols || b.rows - a.rows)[0]!;
};

/** What a rendered cell shows: its text, and how many faint marks of each reason it hovers. */
type Shown = { text: string; marks: (reason: UnknownReason) => number };
const shown = (container: HTMLElement): Shown => {
  const all = [...container.querySelectorAll('*')];
  const counts = new Map<UnknownReason, number>();
  for (const reason of Object.keys(unknownMark) as UnknownReason[]) {
    // the innermost element that shows the mark, hovered with this reason by itself or by a cell around it
    const marks = all.filter((e) => isFaintMark(e, reason) && ![...e.children].some((c) => isFaintMark(c, reason)));
    counts.set(reason, marks.filter((e) => e.closest('[title]')?.getAttribute('title') === unknownReason[reason]).length);
  }
  return { text: (container.textContent ?? '').replace(/\s+/g, ' ').trim(), marks: (reason) => counts.get(reason) ?? 0 };
};

/**
 * Unknowns a display says in words instead of a mark, by display rule (not by gallery case): the field (list positions
 * as `*`) and the reason. Each rule is pinned by the display's own tests.
 */
const IN_WORDS: Record<string, { field: string; reason: UnknownReason; rule: string }[]> = {
  'calibration-panel': [{ field: 'active', reason: 'notApplicable', rule: '"no session" and the track picker (spec 6)' }],
  'damage-card': [
    { field: 'damage.jumps.*.lossMsPerLap', reason: 'insufficientData', rule: '"loss: measuring" (Task P ruling)' },
    { field: 'damage.jumps.*.lossMsPerLap', reason: 'notApplicable', rule: '"loss: not measurable"' },
    { field: 'damage.jumps.*.estimateMsPerLap', reason: 'notApplicable', rule: 'no estimate: the loss text stands alone' },
    { field: 'damage.jumps.*.measuring', reason: 'notApplicable', rule: 'measured or never measurable: the loss text stands alone' },
  ],
  'incident-feed': [
    { field: 'feed.*.forUs.*.gapAfterMs', reason: 'notApplicable', rule: 'the other car retired: DNF' },
    { field: 'feed.*.timeLostMs', reason: 'notApplicable', rule: 'not applicable to the entry: a spanning what text may cover its mark' },
    { field: 'feed.*.where.turn', reason: 'notApplicable', rule: 'no turns in the track file: the sector stands in its place (spec 6.2, D4)' },
    { field: 'feed.*.where.turn', reason: 'insufficientData', rule: 'no apex near: the sector stands in its place (spec 6.2, D4)' },
  ],
  'track-map': [{ field: 'geometry', reason: 'notApplicable', rule: '"no track data" (spec 7.2)' }],
};
const inWords = (widget: string, field: string, reason: UnknownReason): boolean =>
  (IN_WORDS[widget] ?? []).some((x) => x.field === field && x.reason === reason);

describe('unknown marks: an unknown value is never dropped', () => {
  // Each unknown value of a case is swapped for the same field known (from any case of the display). When that changes
  // the display's text, the display shows the value; the unknown must then add a mark of its reason. Each field and
  // reason is judged once, where the display first shows it (the same field of the next car or case adds nothing).
  it.each(WIDGETS.map((w) => [w.decl.name, w] as const))("%s: a value it shows when known shows its reason's mark when unknown", async (name, w) => {
    const cases = Object.entries(casesOf(name));
    const knownOf = new Map<string, Known<unknown>>();
    for (const [, values] of cases) {
      for (const l of leaves(values)) if (l.value.known && !knownOf.has(fieldOf(l.path))) knownOf.set(fieldOf(l.path), l.value);
    }
    const size = widest(w);
    const judged = new Set<string>();
    const dropped: { at: string; reason: UnknownReason }[] = [];
    for (const [caseName, values] of cases) {
      const unknowns = leaves(values).flatMap(({ path, value }) =>
        !value.known && knownOf.has(fieldOf(path)) && !inWords(name, fieldOf(path), value.reason) ? [{ path, reason: value.reason }] : []);
      let base: Shown | undefined;
      for (const { path, reason } of unknowns) {
        const key = `${fieldOf(path)} ${reason}`;
        if (judged.has(key)) continue;
        base ??= await rendered(w, caseName, values, size, shown);
        const swapped = await rendered(w, caseName, withValue(values, path, knownOf.get(fieldOf(path))), size, shown);
        if (swapped.text === base.text) continue; // the display does not show this value here
        judged.add(key);
        if (base.marks(reason) <= swapped.marks(reason)) dropped.push({ at: `${caseName}: ${path.join('.')}`, reason });
      }
    }
    expect(dropped).toEqual([]);
  });
});
