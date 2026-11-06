// @vitest-environment jsdom
// The stint scatter as drawn (spec 6, plan Task 13; C65, C68): the chart on the kit chart, the compounds table with the
// kit source badge (full only), the unknowns, and every gallery case fitting its sizes. Contract assumed of
// `StintScatter.svelte` (props `WidgetProps<typeof widget>`):
//  - every text row is an element of class `line` (as the damage card), one row high;
//  - full: a line naming the current stint's basis (`basis wear` / `basis age`), the chart, then the compounds table:
//    a header line (`CMP`, `TO MED`, `DEG/LAP`, `SD`, `LAPS`, `SOURCE`) and one line per compound starting with its
//    letter; the kit `SourceBadge` right after DEG/LAP, LAPS (the analysis's `laps`, spec 5.1) after SD, then the source
//    in words (`session`, `calibration`, `default`) hovered like the badge; a default row muted (`textDim`). The columns
//    as the approved mockup `docs/design/2026-11-06-sp4.1a/source-badge.html` (LAPS 4 wide, right-aligned);
//  - compact: the chart only (the README: compact drops axis titles, fit labels and the compounds table);
//  - an unknown fit of the current stint shows its reason's kit mark with the reason on hover (full);
//  - the whole value unknown (a rival: `notApplicable`) shows its reason's kit mark with the reason on hover, no chart and
//    no table;
//  - fit (jsdom): no line wider than the panel's columns; the lines and the chart's canvas together no taller than the panel.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { cellBox } from '../../kit/size/size.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { DEFAULT_THEME, role } from '../../theme/index.ts';
import { cases } from './fixtures.ts';
import StintScatter from './StintScatter.svelte';

const box = cellBox(DEFAULT_THEME.fontPx, DEFAULT_THEME.density.lineHeight);
type Size = { mode: 'compact' | 'full'; cols: number; rows: number };
const sizeOf = (s: Size) => ({ ...s, px: { width: s.cols * box.width, height: s.rows * box.height }, dpr: 1 });
const FULL: Size = { mode: 'full', cols: 72, rows: 16 };
const COMPACT: Size = { mode: 'compact', cols: 36, rows: 8 };

// The kit chart measures its box with a ResizeObserver: report the size under test.
let observed = { width: 0, height: 0 };
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: observed }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type CaseName = keyof typeof cases;

/** Renders a case at a size and lets the chart draw (its effects run on later microtasks). */
async function show(name: CaseName, size: Size = FULL): Promise<HTMLElement> {
  const widgetSize = sizeOf(size);
  observed = widgetSize.px;
  const { container } = render(InPanel, {
    component: StintScatter as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { ...cases[name] }, options: {}, size: widgetSize, link: {} },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  // The panel staleness probe of the test parent is not part of the widget.
  container.querySelector('[data-testid="stale-for"]')?.remove();
  return container;
}

const textOf = (e: Element): string => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
const lines = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.line')];
/** The table line of a compound, by its letter at the start. */
const compoundLine = (c: HTMLElement, letter: string): HTMLElement | undefined => lines(c).find((l) => textOf(l).startsWith(`${letter} `));
/** The element showing exactly `text` with no child showing it, inside `within`. */
const shownAs = (within: Element, text: string): HTMLElement | undefined =>
  [...within.querySelectorAll<HTMLElement>('*')].find((e) => e.textContent?.trim() === text && ![...e.children].some((k) => k.textContent?.trim() === text));
const hover = (e: Element): string | null => e.closest('[title]')?.getAttribute('title') ?? null;

const HARD_HOVER = 'calibration · league · 4 sources · league: your override 0.045 · + 7 laps this session (LIN), 31 % session';
const DEFAULT_HOVER = 'default · degradation config default (pitwall estimate)';
const SOFT_HOVER = 'session · 6 laps (LIN, stint 1) + track default';

describe('StintScatter: the chart', () => {
  it.each([FULL, COMPACT])('draws the kit chart ($mode)', async (size) => {
    expect((await show('threeStints', size)).querySelector('canvas')).not.toBeNull();
  });

  it('full names the current stint\'s basis', async () => {
    expect(textOf(await show('oneStint'))).toContain('basis wear');
    expect(textOf(await show('threeStints'))).toContain('basis age');
  });
});

describe('StintScatter: the compounds table (full)', () => {
  it('shows the header and one line per compound in the analysis\'s order', async () => {
    const c = await show('threeStints');
    const header = lines(c).find((l) => textOf(l).startsWith('CMP'));
    expect(header && textOf(header)).toMatch(/^CMP TO MED DEG\/LAP SD LAPS SOURCE$/);
    expect(['S', 'M', 'H', 'I'].map((letter) => compoundLine(c, letter) !== undefined)).toEqual([true, true, true, true]);
    expect(lines(c).indexOf(compoundLine(c, 'S')!)).toBeLessThan(lines(c).indexOf(compoundLine(c, 'H')!));
  });

  it('shows each compound\'s offset, ν, sd and laps as the rows format them', async () => {
    const c = await show('threeStints');
    expect(textOf(compoundLine(c, 'M')!)).toMatch(/^M \+0\.000 \+0\.055 0\.009 10 session$/);
    expect(textOf(compoundLine(c, 'H')!)).toMatch(/^H \+0\.368 \+0\.041ᶜ 0\.015 7 calibration$/);
    // a compound with no stint of ours: LAPS 0
    expect(textOf(compoundLine(c, 'I')!)).toMatch(/ 0 default$/);
  });

  it('the compounds table shows LAPS and the source word and badge per row (the approved mockup, the first case)', async () => {
    const c = await show('oneStint');
    const header = lines(c).find((l) => textOf(l).startsWith('CMP'));
    expect(header && textOf(header)).toMatch(/^CMP TO MED DEG\/LAP SD LAPS SOURCE$/);
    expect(['S', 'M', 'H'].map((l) => textOf(compoundLine(c, l)!))).toEqual([
      'S −0.412 +0.085 0.018 14 session',
      'M +0.000 +0.055 0.009 41 session',
      'H +0.368 +0.041ᶜ 0.015 8 calibration',
    ]);
    expect([...c.querySelectorAll('.source-badge')].map((b) => b.textContent?.trim())).toEqual(['', '', 'ᶜ']);
    expect(hover(shownAs(compoundLine(c, 'M')!, 'session')!)).toBe('session · 41 laps + league');
    expect(hover(shownAs(compoundLine(c, 'H')!, 'ᶜ')!)).toBe('calibration · league · 4 sources · 8 laps + league');
    expect(hover(shownAs(compoundLine(c, 'H')!, 'calibration')!)).toBe('calibration · league · 4 sources · 8 laps + league');
  });

  it('puts the kit source badge right after DEG/LAP: ᶜ for calibration, ᵈ for default, no mark for session', async () => {
    const c = await show('threeStints');
    expect([...c.querySelectorAll('.source-badge')].map((b) => b.textContent?.trim())).toEqual(['', '', 'ᶜ', 'ᵈ']);
    expect(textOf(compoundLine(c, 'H')!)).toContain('+0.041ᶜ');
    expect(textOf(compoundLine(c, 'I')!)).toContain('+0.060ᵈ');
    expect(textOf(compoundLine(c, 'S')!)).not.toMatch(/[ᶜᵈ]/);
  });

  it('hovers each badge with its source and parts', async () => {
    const c = await show('threeStints');
    expect(hover(shownAs(compoundLine(c, 'H')!, 'ᶜ')!)).toBe(HARD_HOVER);
    expect(hover(shownAs(compoundLine(c, 'I')!, 'ᵈ')!)).toBe(DEFAULT_HOVER);
    expect(compoundLine(c, 'S')!.querySelector('.source-badge')?.getAttribute('title')).toBe(SOFT_HOVER);
  });

  it('names the source in words, hovered like the badge', async () => {
    const c = await show('threeStints');
    expect(['S', 'M', 'H', 'I'].map((l) => textOf(compoundLine(c, l)!).split(' ').at(-1))).toEqual(['session', 'session', 'calibration', 'default']);
    expect(hover(shownAs(compoundLine(c, 'H')!, 'calibration')!)).toBe(HARD_HOVER);
    expect(hover(shownAs(compoundLine(c, 'I')!, 'default')!)).toBe(DEFAULT_HOVER);
  });

  it('mutes a default row', async () => {
    const c = await show('threeStints');
    const dim = role('textDim');
    const muted = (l: HTMLElement) => [l, ...l.querySelectorAll<HTMLElement>('*')].some((e) => e.style.color === dim && textOf(e).includes('I'));
    expect(['S', 'M', 'H', 'I'].map((l) => muted(compoundLine(c, l)!))).toEqual([false, false, false, true]);
  });

  it('shows an offset that does not apply as its reason\'s mark', async () => {
    const c = await show('threeStints');
    const mark = shownAs(compoundLine(c, 'I')!, unknownMark.notApplicable);
    expect(mark && hover(mark)).toBe(unknownReason.notApplicable);
    expect(mark?.style.color).toBe(role('textFaint'));
  });
});

describe('StintScatter: compact', () => {
  it('drops the compounds table and the basis line', async () => {
    const t = textOf(await show('threeStints', COMPACT));
    expect(t).not.toContain('DEG/LAP');
    expect(t).not.toContain('basis');
    expect(t).not.toContain('calibration');
  });
});

describe('StintScatter: unknowns', () => {
  it('shows an unknown fit\'s reason mark with its hover, and still draws the laps', async () => {
    const c = await show('unknownFit');
    const mark = shownAs(c, unknownMark.insufficientData);
    expect(mark && hover(mark)).toBe(unknownReason.insufficientData);
    expect(mark?.style.color).toBe(role('textFaint'));
    expect(c.querySelector('canvas')).not.toBeNull();
  });

  it.each([FULL, COMPACT])('shows a rival\'s notApplicable as its mark, with no chart and no table ($mode)', async (size) => {
    const c = await show('rival', size);
    const mark = shownAs(c, unknownMark.notApplicable);
    expect(mark && hover(mark)).toBe(unknownReason.notApplicable);
    expect(c.querySelector('canvas')).toBeNull();
    expect(textOf(c)).not.toContain('DEG/LAP');
  });
});

describe('StintScatter: every case fits its sizes', () => {
  // The mode minimums and the gallery's other fit sizes (gallery.ts lists the same).
  const SIZES: Size[] = [COMPACT, { mode: 'compact', cols: 71, rows: 15 }, FULL, { mode: 'full', cols: 96, rows: 24 }];
  const rows = (Object.keys(cases) as CaseName[]).flatMap((name) => SIZES.map((size) => [name, `${size.mode} ${size.cols}x${size.rows}`, size] as const));

  it.each(rows)('%s at %s', async (name, _at, size) => {
    const c = await show(name, size);
    const px = sizeOf(size).px;
    const wide = lines(c).filter((l) => [...(l.textContent ?? '')].length > size.cols).map((l) => l.textContent);
    expect(wide).toEqual([]);
    expect(lines(c).length).toBeLessThanOrEqual(size.rows);
    const chartHeight = Math.max(0, ...[...c.querySelectorAll('canvas')].map((cv) => cv.height));
    for (const cv of c.querySelectorAll('canvas')) expect(cv.width).toBeLessThanOrEqual(Math.ceil(px.width));
    expect(chartHeight + lines(c).length * box.height).toBeLessThanOrEqual(Math.ceil(px.height));
  });
});
