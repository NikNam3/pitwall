// @vitest-environment jsdom
// The pit-sweep table as it renders (SP4.3b spec §10, V15; mockup docs/design/2026-11-12-sp4.3b/pit-sweep-table.html, full
// 53×14, compact 26×6; README Q2 A, Q3 A, Q4 A; C65, C68). Contract assumed of `PitSweepTable.svelte` (props
// `WidgetProps<typeof widget>`, data `sweep`):
//  - the header line `[data-testid="head"]`; its first cell `[data-testid="compound"]` is the swept compound's letter
//    (kit `COMPOUND_MARK`), its hover `text.compoundHover.auto` when `fromAuto`, else `text.compoundHover.set`; then the
//    headers from `text.headers` (full: REJ, TRF, E[POS], the strip's place labels, P(GAIN), LIFE; compact: no TRF, no strip);
//  - one `[data-testid="row-<i>"]` per shown stop lap, in topic order, with the cells `[data-testid="lap"]` (kit
//    `formatLapNumber(stopLap, 2)`), `rej` (kit `formatPosition`), `trf` (kit `formatCount`; full only), `epos` (kit
//    `formatExpectedPlace`), the kit's place strip (`DistStrip`, form `places`, `.dist-strip`; full only) at the scale
//    `sharedScale` over the shown rows' `positionPmf`, our place now (`sweep.position`) underlined, `pgain` (kit
//    `formatShare`), `life` (`text.lifeMark` in the `warning` role, hover `text.lifeHover`, when `pastLife`; else empty);
//  - a row `inWindow` is bold (a `<strong>`, or `font-weight` bold/600+ on the row);
//  - full shows every row; compact the rows that fit (`size.rows − 1`, the header takes one), centred on the window;
//  - an unknown `sweep.value.table` shows the kit's unknown mark with its reason on hover (kit `TextCell`), no rows;
//    never the panel's computing state (`kit/text.ts` `noDataYet`), which the frame shows only without a value.
import type { UiAction } from '@pitwall/contracts';
import { carId, feedId, type PitSweepRow } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import { sharedScale } from '../../kit/dist/dist.ts';
import type { ResolvedLink } from '../../kit/types.ts';
import { noDataYet, unknownMark, unknownReason } from '../../kit/text.ts';
import { formatCount, formatExpectedPlace, formatLapNumber, formatPosition, formatShare } from '../../kit/values/format.ts';
import { cases, HARD, OUR_PLACE, SOFT } from './fixtures.ts';
import PitSweepTable from './PitSweepTable.svelte';
import * as text from './text.ts';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const SIZES = { compact: { cols: 26, rows: 6 }, full: { cols: 53, rows: 14 } } as const;
const LINK: ResolvedLink = { group: 1, feedId: feedId('20777'), primary: carId(0), compare: [], window: { kind: 'live' } };

type Data = (typeof cases)[keyof typeof cases];
type Size = { cols: number; rows: number };

function mount(data: Data, mode: keyof typeof SIZES = 'full', size: Size = SIZES[mode]) {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const { container } = render(ActionsHarness, {
    send: (_action: UiAction) => Promise.resolve({ ok: true }),
    actions: widget.actions,
    component: PitSweepTable as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 19.6 }, dpr: 1 }, link: LINK },
  });
  return container;
}

const find = (c: Element, id: string): Element | null => c.querySelector(`[data-testid="${id}"]`);
function get(c: Element, id: string): Element {
  const el = find(c, id);
  if (el === null) throw new Error(`no ${id}`);
  return el;
}
const rowsOf = (c: Element): Element[] => [...c.querySelectorAll('[data-testid^="row-"]')];
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Every hover in an element: its own title, its titled ancestor's and its descendants'. */
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
/** Bold: inside or wrapping a `<strong>`, or a bold `font-weight` on the element. */
const isBold = (el: Element): boolean =>
  el.closest('strong') !== null || el.querySelector('strong') !== null || /font-weight:\s*(bold|[6-9]00)/.test(el.getAttribute('style') ?? '');
/** Every visible text node of the widget, trimmed, without empty ones (SVG `<title>` is a hover, not visible). */
function visibleTexts(c: HTMLElement): string[] {
  const walker = c.ownerDocument.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim();
    if (t !== '' && n.parentElement?.closest('title, option, script, style') === null) out.push(t);
  }
  return out;
}
const laps = (c: Element): string[] => rowsOf(c).map((r) => textOf(get(r, 'lap')));
const lapTexts = (rows: PitSweepRow[]): string[] => rows.map((r) => formatLapNumber(r.stopLap, 2));
const known = <T>(k: { known: true; value: T } | { known: false }): T => {
  if (!k.known) throw new Error('unknown');
  return k.value;
};

describe('pit-sweep-table', () => {
  it("the first header cell is the swept compound's letter; hover names auto or set (fromAuto)", () => {
    for (const mode of ['full', 'compact'] as const) {
      const c = mount(cases.autoHard, mode);
      const cell = get(get(c, 'head'), 'compound');
      expect(textOf(cell), mode).toBe('H');
      expect(hovers(cell), mode).toContain(text.compoundHover.auto);
      expect(hovers(cell), mode).not.toContain(text.compoundHover.set);
      cleanup();
      const d = mount(cases.softSet, mode);
      const set = get(get(d, 'head'), 'compound');
      expect(textOf(set), mode).toBe('S');
      expect(hovers(set), mode).toContain(text.compoundHover.set);
      expect(hovers(set), mode).not.toContain(text.compoundHover.auto);
      cleanup();
    }
  });

  it('per row: stop lap, REJ, TRF, E[POS], the place strip (shared scale, our place underlined), P(GAIN) (formatShare), LIFE ■ in warning when pastLife', () => {
    const c = mount(cases.autoHard);
    const head = textOf(get(c, 'head'));
    for (const h of [text.headers.rej, text.headers.trf, text.headers.ePos, text.headers.pGain, text.headers.life]) expect(head).toContain(h);
    const rows = rowsOf(c);
    expect(rows).toHaveLength(HARD.rows.length);
    const scale = sharedScale(HARD.rows.map((r) => r.positionPmf));
    const heights: number[] = [];
    HARD.rows.forEach((r, i) => {
      const el = rows[i]!;
      expect(textOf(get(el, 'lap')), `row ${i}`).toBe(formatLapNumber(r.stopLap, 2));
      expect(textOf(get(el, 'rej')), `row ${i}`).toBe(formatPosition(known(r.rejoinPosition)));
      expect(textOf(get(el, 'trf')), `row ${i}`).toBe(formatCount(known(r.traffic)));
      expect(textOf(get(el, 'epos')), `row ${i}`).toBe(formatExpectedPlace(r.ePos));
      expect(textOf(get(el, 'pgain')), `row ${i}`).toBe(formatShare(r.pGain));
      // the strip: one cell per place, our place now underlined, the bars against the panel's largest bin (Q2 A, Q3 A)
      const strip = el.querySelector('.dist-strip');
      expect(strip, `row ${i}`).not.toBeNull();
      expect(strip!.getAttribute('data-form')).toBe('places');
      expect(strip!.getAttribute('data-cells')).toBe(String(r.positionPmf.length));
      const under = strip!.querySelector('.our-place');
      expect(under, `row ${i}`).not.toBeNull();
      expect(Number(under!.getAttribute('x'))).toBe((OUR_PLACE - 1) * 8);
      const bars = [...strip!.querySelectorAll('rect.bar')].map((b) => Number(b.getAttribute('height')));
      const tallest = Math.max(...bars);
      heights.push(tallest);
      // a row's tallest bar stands at its largest bin's share of the shared scale
      expect(tallest / 13, `row ${i}`).toBeCloseTo(Math.max(...r.positionPmf) / scale, 6);
      // LIFE: the amber square past the tyres' life, empty otherwise
      const life = get(el, 'life');
      if (known(r.pastLife)) {
        expect(textOf(life), `row ${i}`).toBe(text.lifeMark);
        expect(life.outerHTML, `row ${i}`).toMatch(/--pw-warning/);
        expect(hovers(life), `row ${i}`).toContain(text.lifeHover);
      } else {
        expect(textOf(life), `row ${i}`).toBe('');
      }
    });
    // rows compare: only the row holding the panel's largest bin reaches full height
    expect(Math.max(...heights)).toBeCloseTo(13, 6);
    expect(Math.min(...heights)).toBeLessThan(13 - 0.4);
    // the mark itself is the square (gen.mjs LIFE_MARK)
    expect(text.lifeMark).toBe('■');
  });

  it('inWindow rows bold', () => {
    for (const [data, table] of [[cases.autoHard, HARD], [cases.softSet, SOFT]] as const) {
      const c = mount(data);
      const rows = rowsOf(c);
      table.rows.forEach((r, i) => expect(isBold(rows[i]!), `${table.compound} L${r.stopLap}`).toBe(r.inWindow));
      cleanup();
    }
  });

  it('compact: the rows that fit, centred on the window, no strip, no traffic', () => {
    // 26×6: the header and five rows, around the window L19–21 (mockup: L18–22)
    const c = mount(cases.autoHard, 'compact');
    expect(laps(c)).toEqual(['L18', 'L19', 'L20', 'L21', 'L22']);
    expect(c.querySelector('.dist-strip')).toBeNull();
    expect(find(c, 'trf')).toBeNull();
    expect(textOf(get(c, 'head'))).not.toContain(text.headers.trf);
    // the other cells stay, the window rows bold
    const rows = rowsOf(c);
    for (const r of rows) for (const id of ['lap', 'rej', 'epos', 'pgain', 'life']) expect(find(r, id), id).not.toBeNull();
    expect(rows.map(isBold)).toEqual([false, true, true, true, false]);
    cleanup();
    // S: the window L18–20, so L17–21
    expect(laps(mount(cases.softSet, 'compact'))).toEqual(['L17', 'L18', 'L19', 'L20', 'L21']);
    cleanup();
    // taller: seven rows around L19–21
    expect(laps(mount(cases.autoHard, 'compact', { cols: 26, rows: 8 }))).toEqual(['L17', 'L18', 'L19', 'L20', 'L21', 'L22', 'L23']);
    cleanup();
    // room for every row: all of them
    expect(laps(mount(cases.autoHard, 'compact', { cols: 26, rows: 20 }))).toEqual(lapTexts(HARD.rows));
    cleanup();
    // full shows every row at its minimum size
    expect(laps(mount(cases.autoHard, 'full'))).toEqual(lapTexts(HARD.rows));
  });

  it("the table notApplicable (no set of the compound) or unknown (auto unknown): the kit's mark with the reason, never the computing state", () => {
    for (const [data, reason] of [[cases.noSet, 'notApplicable'], [cases.autoUnknown, 'insufficientData']] as const) {
      for (const mode of ['full', 'compact'] as const) {
        const c = mount(data, mode);
        const texts = visibleTexts(c);
        expect(texts, `${reason} ${mode}`).toContain(unknownMark[reason]);
        const marked = [...c.querySelectorAll('[title]')].map((e) => e.getAttribute('title'));
        expect(marked, `${reason} ${mode}`).toContain(unknownReason[reason]);
        expect(rowsOf(c), `${reason} ${mode}`).toHaveLength(0);
        expect(textOf(c), `${reason} ${mode}`).not.toContain(noDataYet);
        cleanup();
      }
    }
  });

  it('no sentence in the visible text', () => {
    // numbers, shapes, headers, laps and compound letters only (memory "no explaining text"); hovers may be phrases
    const sentence = /(?:\b[a-z]{2,}\b[\s,]+){3}\b[a-z]{2,}\b/;
    for (const [name, data] of Object.entries(cases) as [string, Data][]) {
      if (!('sweep' in data)) continue;
      for (const mode of ['full', 'compact'] as const) {
        const c = mount(data, mode);
        const texts = visibleTexts(c);
        expect(texts.length, `${name} ${mode}`).toBeGreaterThan(0);
        for (const t of texts) expect(t, `${name} ${mode}`).not.toMatch(sentence);
        cleanup();
      }
    }
  });
});

// SP4.3b2 Task 18v: the display against its approved mockup (pit-sweep-table.html, gen.mjs `sweepLines`, `table`).
/** The characters of `scope`'s text before `el`, spaces as rendered (an inline chart counts no character). */
function textBefore(scope: Element, el: Element): number {
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    if (el.contains(t)) continue;
    if (t.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) n += (t.textContent ?? '').length;
  }
  return n;
}
const words = (el: Element): string[] => (el.textContent ?? '').trim().split(/\s+/);

describe('pit-sweep-table against the mockup (Task 18v)', () => {
  it('the header cells one space apart: H REJ TRF E[POS] P1 P10 P20 P(GAIN) LIFE (full), H REJ E[POS] P(GAIN) (compact)', () => {
    const h = text.headers;
    const full = mount(cases.autoHard, 'full');
    expect(words(get(full, 'head'))).toEqual(['H', h.rej, h.trf, h.ePos, formatPosition(1), formatPosition(10), formatPosition(20), h.pGain, h.life]);
    cleanup();
    const compact = mount(cases.autoHard, 'compact');
    expect(words(get(compact, 'head'))).toEqual(['H', h.rej, h.ePos, h.pGain]);
  });

  it('full: the strip stands under its labels, P1 above its first cell and P20 ending at its last', () => {
    const c = mount(cases.autoHard, 'full');
    const head = get(c, 'head');
    const headText = head.textContent ?? '';
    const p1 = headText.indexOf(formatPosition(1));
    const p20 = headText.indexOf(formatPosition(20));
    expect(p1).toBeGreaterThan(0);
    rowsOf(c).forEach((row, i) => {
      const strip = row.querySelector('.dist-strip')!;
      const at = textBefore(row, strip);
      const cells = Number(strip.getAttribute('data-cells'));
      expect(at, `row ${i}: the strip's first cell under P1`).toBe(p1);
      expect(at + cells, `row ${i}: the strip's last cell under the end of P20`).toBe(p20 + formatPosition(20).length);
    });
  });

  it('full: every second row carries the row band (bgRowBand), a window row none', () => {
    const rows = known(cases.autoHard.sweep.value.table).rows;
    expect(rows.some((r, i) => i % 2 === 1 && !r.inWindow)).toBe(true);
    const c = mount(cases.autoHard, 'full');
    const banded = (el: Element): boolean =>
      [el, ...el.querySelectorAll('*')].some((e) => /bgRowBand/.test(e.getAttribute('style') ?? ''));
    rowsOf(c).forEach((row, i) => {
      expect(banded(row), `row ${i}`).toBe(i % 2 === 1 && !rows[i]!.inWindow);
    });
  });
});
