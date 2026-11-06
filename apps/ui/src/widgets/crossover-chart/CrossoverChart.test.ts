// @vitest-environment jsdom
// The crossover chart as drawn (SP4.1b spec 4, plan Task 12; mockup docs/design/2026-10-30-sp4a-displays/5-weather.html,
// full 72×16, compact 40×3; C65, C68). Contract assumed of `CrossoverChart.svelte` (props `WidgetProps<typeof widget>`):
//  - every text row is an element of class `line`, one row high; whitespace between words is layout (tests collapse it);
//  - full: two lines, `US <us> of dry ref <dryRef>   PAYBACK <payback>` and `FIRST FASTER <code> on <type> in <sector> on
//    <lap>`, then the kit chart of `chartSeries` (x axis `lap`, y the median lap time); no chart while there is no series;
//  - compact: the three numbers alone, one per line: `US <us> of dry ref <dryRef>`, `FIRST FASTER <code> <type> <sector>
//    <lap>`, `PAYBACK <payback>`; no chart;
//  - the first faster's type word in its type's role (`typeRole`); the payback followed by the kit `SourceBadge` of its
//    loss source (no mark for a session value, `ᶜ`, `ᵈ`), which carries the badge's hover;
//  - an unknown number shows as the kit shows it: its reason's mark (`unknownMark`) with the reason on hover;
//  - fit (jsdom): no line wider than the panel's columns; the lines and the chart's canvas together no taller than the panel.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { cellBox } from '../../kit/size/size.ts';
import { sourceHover, unknownMark, unknownReason } from '../../kit/text.ts';
import { DEFAULT_THEME, role } from '../../theme/index.ts';
import CrossoverChart from './CrossoverChart.svelte';
// The gallery's cases and fit sizes come from fixtures.ts: only the gallery imports gallery.ts (C69).
import { calibrationSource, cases, fit, sessionSource } from './fixtures.ts';
import { widget } from './widget.ts';

const box = cellBox(DEFAULT_THEME.fontPx, DEFAULT_THEME.density.lineHeight);
type Size = { mode: string; cols: number; rows: number };
const sizeOf = (s: Size) => ({ ...s, px: { width: s.cols * box.width, height: s.rows * box.height }, dpr: 1 });
const FULL: Size = { mode: 'full', cols: 72, rows: 16 };
const COMPACT: Size = { mode: 'compact', cols: 40, rows: 3 };

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
    component: CrossoverChart as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { ...cases[name] }, options: {}, size: widgetSize, link: {} },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  // The panel staleness probe of the test parent is not part of the widget.
  container.querySelector('[data-testid="stale-for"]')?.remove();
  return container;
}

const textOf = (e: Element): string => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
const lineElements = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.line')];
const lines = (c: HTMLElement): string[] => lineElements(c).map(textOf).filter((t) => t !== '');
const lineStarting = (c: HTMLElement, prefix: string): HTMLElement | undefined => lineElements(c).find((e) => textOf(e).startsWith(prefix));
/** The innermost element of `scope` whose own text, trimmed, is `t`. */
const cellWithText = (scope: HTMLElement, t: string): HTMLElement | undefined =>
  [...scope.querySelectorAll<HTMLElement>('*')].reverse().find((e) => (e.textContent ?? '').trim() === t);
/** The colour an element shows: its own inline colour or the nearest ancestor's, up to the widget. */
function colourOf(el: HTMLElement | undefined, stop: HTMLElement): string {
  for (let e: HTMLElement | null = el ?? null; e !== null && e !== stop.parentElement; e = e.parentElement) {
    if (e.style.color !== '') return e.style.color;
  }
  return '';
}
const hover = (e: Element | undefined): string | null => e?.closest('[title]')?.getAttribute('title') ?? null;
const NA = unknownMark.notApplicable;

describe('the crossover chart at its gallery cases', () => {
  it('the gallery has the mockup\'s cases: L34 wet (first), L23 dry, a rival not applicable', () => {
    expect(Object.keys(cases)).toEqual(expect.arrayContaining(['wet', 'dry', 'rival']));
    expect(Object.keys(cases)[0]).toBe('wet');
  });

  it('the gallery fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });

  const rows = (Object.keys(cases) as CaseName[]).flatMap((name) => fit.map((size) => [name, `${size.mode} ${size.cols}x${size.rows}`, size] as const));
  it.each(rows)('%s at %s keeps every line within its columns and everything within its rows', async (name, _at, size) => {
    const c = await show(name, size);
    const px = sizeOf(size).px;
    const wide = lineElements(c).filter((l) => [...(l.textContent ?? '')].length > size.cols).map((l) => l.textContent);
    expect(wide).toEqual([]);
    expect(lineElements(c).length).toBeLessThanOrEqual(size.rows);
    const chartHeight = Math.max(0, ...[...c.querySelectorAll('canvas')].map((cv) => cv.height));
    for (const cv of c.querySelectorAll('canvas')) expect(cv.width).toBeLessThanOrEqual(Math.ceil(px.width));
    expect(chartHeight + lineElements(c).length * box.height).toBeLessThanOrEqual(Math.ceil(px.height));
  });
});

describe('full (72×16): the mockup at L34', () => {
  it('shows US with the dry reference and the payback, then the first faster car', async () => {
    expect(lines(await show('wet'))).toEqual([
      'US 109.3% of dry ref 1:29.412 PAYBACK 12.3 laps',
      'FIRST FASTER GAS on inter in S2 on L33',
    ]);
  });

  it('draws the medians on the kit chart', async () => {
    expect((await show('wet')).querySelector('canvas')).not.toBeNull();
  });

  it('shows the first faster car\'s type in its type\'s colour', async () => {
    const c = await show('wet');
    expect(colourOf(cellWithText(lineStarting(c, 'FIRST FASTER')!, 'inter'), c)).toBe(role('series3'));
  });

  it('puts no badge mark on a payback whose pit loss was measured this session, and hovers it with the source', async () => {
    const c = await show('wet');
    const badge = lineStarting(c, 'US')!.querySelector('.source-badge');
    expect(badge?.textContent).toBe('');
    expect(badge?.getAttribute('title')).toBe(sourceHover.session(sessionSource.parts));
  });

  it('puts the ᶜ badge on a payback whose pit loss is the calibration\'s, hovered with the set', async () => {
    const c = await show('wetOnCalibration');
    expect(lines(c)[0]).toBe('US 109.3% of dry ref 1:29.412 PAYBACK 12.3 lapsᶜ');
    const badge = lineStarting(c, 'US')!.querySelector('.source-badge');
    const cal = calibrationSource as Extract<typeof calibrationSource, { kind: 'calibration' }>;
    expect(badge?.getAttribute('title')).toBe(sourceHover.calibration(cal.setName, cal.sources, cal.parts));
  });
});

describe('full: L23 dry', () => {
  it('shows first faster and payback not applicable, as the kit shows them', async () => {
    const c = await show('dry');
    expect(lines(c)).toEqual([`US 100.6% of dry ref 1:29.412 PAYBACK ${NA}`, `FIRST FASTER ${NA}`]);
    expect(hover(cellWithText(lineStarting(c, 'FIRST FASTER')!, NA))).toBe(unknownReason.notApplicable);
    expect(colourOf(cellWithText(lineStarting(c, 'FIRST FASTER')!, NA), c)).toBe(role('textFaint'));
  });

  it('shows no badge on a payback that does not apply', async () => {
    expect((await show('dry')).querySelector('.source-badge')).toBeNull();
  });

  it('still draws the slick median on the chart', async () => {
    expect((await show('dry')).querySelector('canvas')).not.toBeNull();
  });
});

describe('a rival (every field not applicable)', () => {
  it.each([FULL, COMPACT])('shows every number as its reason\'s mark with the reason on hover, and no chart ($mode)', async (size) => {
    const c = await show('rival', size);
    expect(lines(c)).toEqual(
      size.mode === 'full'
        ? [`US ${NA} of dry ref ${NA} PAYBACK ${NA}`, `FIRST FASTER ${NA}`]
        : [`US ${NA} of dry ref ${NA}`, `FIRST FASTER ${NA}`, `PAYBACK ${NA}`],
    );
    expect(hover(cellWithText(lineStarting(c, 'US')!, NA))).toBe(unknownReason.notApplicable);
    expect(c.querySelector('canvas')).toBeNull();
  });
});

describe('compact (40×3): the three numbers', () => {
  it('shows US, first faster and payback, one per line, as the mockup', async () => {
    expect(lines(await show('wet', COMPACT))).toEqual([
      'US 109.3% of dry ref 1:29.412',
      'FIRST FASTER GAS inter S2 L33',
      'PAYBACK 12.3 laps',
    ]);
  });

  it('draws no chart', async () => {
    expect((await show('wet', COMPACT)).querySelector('canvas')).toBeNull();
  });

  it('keeps the badge on the payback', async () => {
    const c = await show('wetOnCalibration', COMPACT);
    expect(textOf(lineStarting(c, 'PAYBACK')!)).toBe('PAYBACK 12.3 lapsᶜ');
    expect(lineStarting(c, 'PAYBACK')!.querySelector('.source-badge')).not.toBeNull();
  });

  it('shows the dry case\'s first faster and payback not applicable', async () => {
    expect(lines(await show('dry', COMPACT))).toEqual(['US 100.6% of dry ref 1:29.412', `FIRST FASTER ${NA}`, `PAYBACK ${NA}`]);
  });
});
