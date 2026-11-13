// @vitest-environment jsdom
// The strategy table as it renders (SP4.3b spec §10; mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html, full
// 88×13, compact 46×6; Q7 A, Q9 B, Q10 B; C65, C68, C73, C74). Contract assumed of `StrategyTable.svelte` (props
// `WidgetProps<typeof widget>`, data `plan` and `cars`) and its `StrategyChart.svelte` (SVG, theme roles only):
//  - the chart `[data-testid="chart"]`; per row i its drawn line `[data-testid="line-<i>"]` carrying `chartLines`' look
//    as attributes `data-role` (the role), `data-width` (px) and `data-dotted` (`true`/`false`), and its points, when
//    drawn, as `circle` elements inside it; a click on it toggles the highlight; the faint vertical at our place now
//    `[data-testid="now-line"]`; the highlighted row's E[pos] tick `[data-testid="epos-tick"]`, only with a highlight;
//  - full: the list beside the chart, one `[data-testid="row-<i>"]` per row (a click toggles the highlight), its tie
//    bracket `[data-testid="bracket-<i>"]` (with `data-role`) on tied rows only; the info rows `[data-testid="info"]`:
//    the header line (`#`, `SRC`, `STOPS`, `TRG`, `E[POS]`, `E[PTS]`, `ΔTIME`/`ΔPLAN`) always, the highlighted row's
//    values (TRG in `[data-testid="trg"]`: the number of trigger lines shown), its button (`<button data-testid="commit">`
//    or, on the committed row, `<button data-testid="clear">`) and its triggers (`rows.triggerTexts` with data `cars`, the
//    `cars.overview` identities: a rival by race number) only with a highlight; the footer `[data-testid="footer"]` `N <scenarios>  CAND <candidates>`;
//  - compact: the chart alone; with a highlight one info line `[data-testid="info"]` (rank, stops, E[pos], E[points]);
//    no list, no footer, no buttons (Q7 A);
//  - the highlight is component state (window-local, C73): it sends nothing; a second click on the same row clears it;
//  - an unknown `plan.value` shows the kit's unknown mark with its reason on hover; every hover from text.ts.
// `send` comes from the panel (kit `getUiActions`); test/kit/ActionsHarness.svelte stands in for it with the widget's
// declared actions (C74), and the panel's resolved link is a non-default feed (the action carries `link.feedId`, R24).
import type { UiAction } from '@pitwall/contracts';
import { carId, feedId, type McRow } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import type { ResolvedLink } from '../../kit/types.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { formatCount, formatExpectedPlace, formatPoints, formatPosition, formatRaceNumber } from '../../kit/values/format.ts';
import { DEFAULT_THEME } from '../../theme/index.ts';
import { cases, COMMITTED, FIELD, NO_HIGHLIGHT, RIVAL, RIVAL_NUMBER, table, type PlanTable } from './fixtures.ts';
import StrategyTable from './StrategyTable.svelte';
import * as text from './text.ts';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const SIZES = { compact: { cols: 46, rows: 6 }, full: { cols: 88, rows: 13 } } as const;
const LINK: ResolvedLink = { group: 2, feedId: feedId('20778'), primary: carId(1), compare: [], window: { kind: 'live' } };
const THIN = String(DEFAULT_THEME.chart.lineWidth);
const THICK = String(DEFAULT_THEME.chart.ownCarLineWidth);
/** Task 18v: the lines compact draws, the best-ranked rows (gen.mjs `prepRows`: `n: full ? 8 : 5`). */
const COMPACT_LINES = 5;
/** Task 18v: the chart's right label room in cells (gen.mjs `chartSvgB`: `m.r = 2 * CELL_W`). */
const RIGHT_PAD_CELLS = 2;

type Data = (typeof cases)[keyof typeof cases];

function mount(data: Data, mode: keyof typeof SIZES = 'full') {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const size = SIZES[mode];
  const { container } = render(ActionsHarness, {
    send: (action: UiAction) => {
      sent.push(action);
      return Promise.resolve({ ok: true });
    },
    actions: widget.actions,
    component: StrategyTable as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 19.6 }, dpr: 1 }, link: LINK },
  });
  return { container, sent };
}

const find = (c: Element, id: string): Element | null => c.querySelector(`[data-testid="${id}"]`);
function get(c: HTMLElement, id: string): Element {
  const el = find(c, id);
  if (el === null) throw new Error(`no ${id}`);
  return el;
}
const all = (c: HTMLElement, prefix: string): Element[] => [...c.querySelectorAll(`[data-testid^="${prefix}"]`)];
const lineLook = (el: Element) => ({ role: el.getAttribute('data-role'), width: el.getAttribute('data-width'), dotted: el.getAttribute('data-dotted') === 'true', dots: el.querySelectorAll('circle').length });
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Every hover in an element: its own title, its titled ancestor's and its descendants'. */
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
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
const valueOf = (d: Data): PlanTable => {
  if (!('plan' in d) || !d.plan.value.known) throw new Error('no plan');
  return d.plan.value.value;
};

describe('strategy-table', () => {
  it('a click on a line or list row highlights it: ownCar, thick, its points, the E[pos] tick; the rest of its tie group textDim, the others textFaint; a second click clears', async () => {
    const rows: McRow[] = NO_HIGHLIGHT.rows;
    const { container: c, sent } = mount(cases.noHighlight);
    // no highlight: every line textDim, thin, no points, no tick, no info values
    for (let i = 0; i < rows.length; i++) expect(lineLook(get(c, `line-${i}`)), `row ${i}`).toEqual({ role: 'textDim', width: THIN, dotted: false, dots: 0 });
    expect(find(c, 'now-line')).not.toBeNull();
    expect(find(c, 'epos-tick')).toBeNull();
    expect(find(c, 'commit')).toBeNull();

    // a click on the line of the tied leader
    await fireEvent.click(get(c, 'line-0'));
    expect(lineLook(get(c, 'line-0'))).toEqual({ role: 'ownCar', width: THICK, dotted: false, dots: rows[0]!.positionPmf.length });
    for (let i = 1; i < rows.length; i++) {
      expect(get(c, `line-${i}`).getAttribute('data-role'), `row ${i}`).toBe(rows[i]!.tie ? 'textDim' : 'textFaint');
      expect(get(c, `line-${i}`).querySelectorAll('circle'), `row ${i}`).toHaveLength(0);
    }
    expect(find(c, 'epos-tick')).not.toBeNull();
    const info = textOf(get(c, 'info'));
    expect(info).toContain(formatExpectedPlace(rows[0]!.ePos));
    expect(info).toContain(formatPoints(rows[0]!.ePoints));
    expect(find(c, 'commit')).not.toBeNull();

    // a second click clears
    await fireEvent.click(get(c, 'line-0'));
    expect(lineLook(get(c, 'line-0'))).toEqual({ role: 'textDim', width: THIN, dotted: false, dots: 0 });
    expect(find(c, 'epos-tick')).toBeNull();
    expect(find(c, 'commit')).toBeNull();

    // a click on a list row (an untied one): it white and thick, every other line faint
    const u = rows.findIndex((r) => !r.tie);
    await fireEvent.click(get(c, `row-${u}`));
    expect(lineLook(get(c, `line-${u}`))).toEqual({ role: 'ownCar', width: THICK, dotted: false, dots: rows[u]!.positionPmf.length });
    for (let i = 0; i < rows.length; i++) if (i !== u) expect(get(c, `line-${i}`).getAttribute('data-role'), `row ${i}`).toBe('textFaint');
    await fireEvent.click(get(c, `row-${u}`));
    expect(get(c, `line-${u}`).getAttribute('data-role')).toBe('textDim');
    // window-local (C73): nothing sent
    expect(sent).toEqual([]);
  });

  it('the committed line stays ownCar at normal width; a highlighted other line is dotted beside it', async () => {
    const k = COMMITTED.rows.findIndex((r) => r.committed);
    const h = COMMITTED.rows.findIndex((r, i) => i !== k && !r.tie);
    const { container: c } = mount(cases.committed);
    expect(lineLook(get(c, `line-${k}`))).toEqual({ role: 'ownCar', width: THIN, dotted: false, dots: 0 });
    await fireEvent.click(get(c, `row-${h}`));
    expect(lineLook(get(c, `line-${h}`))).toMatchObject({ role: 'ownCar', width: THICK, dotted: true });
    expect(lineLook(get(c, `line-${k}`))).toEqual({ role: 'ownCar', width: THIN, dotted: false, dots: 0 });
    // the committed row highlighted itself: white, thick, dotted, its points (the mockup caption); the others thin
    await fireEvent.click(get(c, `row-${k}`));
    expect(lineLook(get(c, `line-${k}`))).toEqual({ role: 'ownCar', width: THICK, dotted: true, dots: COMMITTED.rows[k]!.positionPmf.length });
    expect(lineLook(get(c, `line-${h}`))).toMatchObject({ width: THIN, dotted: false, dots: 0 });
  });

  it('the info rows: TRG the number of trigger lines (SC/VSC joined is one); a cover trigger names the rival by race number', async () => {
    // TRG: the sample's policies show 3 lines (SC/VSC, DMG, DEG) out of 4 triggers
    {
      const { container: c } = mount(cases.noHighlight);
      await fireEvent.click(get(c, 'row-0'));
      const info = get(c, 'info');
      expect(find(info, 'trg')?.textContent?.trim()).toBe('3');
      expect(textOf(info)).toContain('SC/VSC L12–24');
      cleanup();
    }
    // the cover rule on slot 3, race number 44: `COVER #44 1.0 s`, never `#3`; TRG 4
    {
      const v = valueOf(cases.rival);
      const r = v.rows.findIndex((x) => x.rule === 'cover');
      const { container: c } = mount(cases.rival);
      await fireEvent.click(get(c, `row-${r}`));
      const info = get(c, 'info');
      expect(textOf(info)).toContain(`COVER ${formatRaceNumber(RIVAL_NUMBER)} 1.0 s`);
      expect(textOf(info)).not.toContain(`#${RIVAL}`);
      expect(find(info, 'trg')?.textContent?.trim()).toBe('4');
      cleanup();
    }
    // the rival missing from cars.overview: the kit's unknown mark in its place
    {
      const data = { plan: cases.rival.plan, cars: FIELD.filter((car) => car.id !== RIVAL) };
      const r = valueOf(data).rows.findIndex((x) => x.rule === 'cover');
      const { container: c } = mount(data);
      await fireEvent.click(get(c, `row-${r}`));
      expect(textOf(get(c, 'info'))).toContain(`COVER ${unknownMark.notReceived} 1.0 s`);
    }
  });

  it('commit sends plan.commit { feedId: link.feedId, carId: link.primary, policy: row.policy }; clear sends plan.clear { feedId: link.feedId, carId: link.primary }', async () => {
    const { container: c, sent } = mount(cases.committed);
    const rows = COMMITTED.rows;
    const k = rows.findIndex((r) => r.committed);
    const h = rows.findIndex((r) => !r.committed);
    // a row other than the committed one: commit, no clear
    await fireEvent.click(get(c, `row-${h}`));
    expect(find(c, 'clear')).toBeNull();
    await fireEvent.click(get(c, 'commit'));
    expect(sent).toEqual([{ kind: 'plan.commit', feedId: LINK.feedId, carId: LINK.primary, policy: rows[h]!.policy }]);
    // the committed row: clear, no commit
    await fireEvent.click(get(c, `row-${k}`));
    expect(find(c, 'commit')).toBeNull();
    await fireEvent.click(get(c, 'clear'));
    expect(sent[1]).toEqual({ kind: 'plan.clear', feedId: LINK.feedId, carId: LINK.primary });
    expect(sent).toHaveLength(2);
    expect(sent.every((a) => 'feedId' in a && a.feedId === feedId('20778'))).toBe(true);
  });

  it('one row; all rows tied; an infeasible committed row (its reason on hover); notApplicable; computing', async () => {
    // one row: one line, one list row, no bracket
    {
      const { container: c } = mount(cases.oneRow);
      expect(all(c, 'line-')).toHaveLength(1);
      expect(all(c, 'row-')).toHaveLength(1);
      expect(all(c, 'bracket-')).toHaveLength(0);
      await fireEvent.click(get(c, 'row-0'));
      expect(find(c, 'commit')).not.toBeNull();
      cleanup();
    }
    // every row tied: one bracket over all, each a tie hover
    {
      const v = valueOf(cases.allTied);
      expect(v.rows.every((r) => r.tie && r.rank === 1)).toBe(true);
      const { container: c } = mount(cases.allTied);
      expect(all(c, 'bracket-')).toHaveLength(v.rows.length);
      for (const b of all(c, 'bracket-')) expect(hovers(b)).toContain(text.tieHover);
      // a highlight in the one group: every other line stays textDim
      await fireEvent.click(get(c, 'row-2'));
      v.rows.forEach((_, i) => {
        if (i !== 2) expect(get(c, `line-${i}`).getAttribute('data-role'), `row ${i}`).toBe('textDim');
      });
      cleanup();
    }
    // an infeasible committed row: its reason on its list row's hover
    {
      const v = valueOf(cases.infeasible);
      const k = v.rows.findIndex((r) => r.committed);
      expect(v.rows[k]!.infeasible).toBe('stopLapPassed');
      const { container: c } = mount(cases.infeasible);
      expect(hovers(get(c, `row-${k}`))).toContain(text.infeasible.stopLapPassed);
      cleanup();
    }
    // notApplicable: the kit's mark, its reason on hover, no chart
    for (const mode of ['full', 'compact'] as const) {
      const { container: c } = mount(cases.notApplicable, mode);
      expect(visibleTexts(c)).toContain(unknownMark.notApplicable);
      expect(hovers(c.querySelector('[title]') ?? c)).toContain(unknownReason.notApplicable);
      expect(find(c, 'chart')).toBeNull();
      cleanup();
    }
    // computing: no value yet, so the panel frame shows its computing state; the gallery case carries no plan
    expect('plan' in cases.computing).toBe(false);
  });

  it('compact: the chart alone without a highlight; with one, the chart and one info line of the highlighted row; no buttons', async () => {
    const rows = NO_HIGHLIGHT.rows;
    const { container: c } = mount(cases.noHighlight, 'compact');
    expect(find(c, 'chart')).not.toBeNull();
    // Task 18v: compact draws the best-ranked rows only (gen.mjs `prepRows`, n 5)
    expect(all(c, 'line-')).toHaveLength(Math.min(COMPACT_LINES, rows.length));
    expect(all(c, 'row-')).toHaveLength(0);
    expect(find(c, 'info')).toBeNull();
    expect(find(c, 'footer')).toBeNull();
    expect(c.querySelectorAll('button')).toHaveLength(0);

    await fireEvent.click(get(c, 'line-3'));
    const info = get(c, 'info');
    const line = textOf(info);
    expect(line).toContain(String(rows[3]!.rank));
    expect(line).toContain(formatExpectedPlace(rows[3]!.ePos));
    expect(line).toContain(formatPoints(rows[3]!.ePoints));
    expect(find(c, 'chart')).not.toBeNull();
    expect(c.querySelectorAll('button')).toHaveLength(0);
    cleanup();

    // committed, the committed row highlighted: still no clear in compact (Q7 A)
    const k = COMMITTED.rows.findIndex((r) => r.committed);
    const { container: d } = mount(cases.committed, 'compact');
    await fireEvent.click(get(d, `line-${k}`));
    expect(find(d, 'info')).not.toBeNull();
    expect(d.querySelectorAll('button')).toHaveLength(0);
  });

  it('no sentence in the visible text', async () => {
    // numbers, shapes, headers, laps, compound letters and button words only (memory "no explaining text"); hovers may be phrases
    const sentence = /(?:\b[a-z]{2,}\b[\s,]+){3}\b[a-z]{2,}\b/;
    for (const [name, data] of Object.entries(cases) as [string, Data][]) {
      if (!('plan' in data)) continue;
      for (const mode of ['full', 'compact'] as const) {
        const { container: c } = mount(data, mode);
        const check = (state: string) => {
          const texts = visibleTexts(c);
          expect(texts.length, `${name} ${mode} ${state}`).toBeGreaterThan(0);
          for (const t of texts) expect(t, `${name} ${mode} ${state}`).not.toMatch(sentence);
        };
        check('plain');
        if (find(c, 'line-0') !== null) {
          await fireEvent.click(get(c, 'line-0'));
          check('highlighted');
        }
        cleanup();
      }
    }
  });

  it('full: the footer N and CAND; the info header ΔTIME, ΔPLAN with a commit', async () => {
    const { container: c } = mount(cases.noHighlight);
    const v: PlanTable = table();
    expect(textOf(get(c, 'footer'))).toBe(`N ${formatCount(v.scenarios)} CAND ${formatCount(v.candidates)}`);
    expect(textOf(get(c, 'info'))).toContain('ΔTIME');
    cleanup();
    const { container: d } = mount(cases.committed);
    expect(textOf(get(d, 'info'))).toContain('ΔPLAN');
    expect(textOf(get(d, 'info'))).not.toContain('ΔTIME');
  });
});

// SP4.3b2 Task 18v: the display against its approved mockup (strategy-table-b.html, gen.mjs `chartSvgB`, `prepRows`).
describe('strategy-table against the mockup (Task 18v)', () => {
  it("the last place label sits two cells inside the chart's right edge, full and compact (gen.mjs chartSvgB m.r)", () => {
    const places = NO_HIGHLIGHT.rows[0]!.positionPmf.length;
    for (const mode of ['full', 'compact'] as const) {
      const { container: c } = mount(cases.noHighlight, mode);
      const chart = get(c, 'chart');
      const cellW = 8; // mount: px.width = cols × 8
      const width = Number(chart.getAttribute('width'));
      const last = [...chart.querySelectorAll('text')].find((t) => (t.textContent ?? '').trim() === formatPosition(places));
      expect(last, mode).toBeDefined();
      // the label is centred on the last place: that x keeps the right label room free
      expect(Number(last!.getAttribute('x')), mode).toBeLessThanOrEqual(width - RIGHT_PAD_CELLS * cellW + 1e-6);
      cleanup();
    }
  });

  it("compact draws the five best-ranked rows' lines; full every row's (gen.mjs prepRows)", () => {
    const rows = NO_HIGHLIGHT.rows;
    expect(rows.length).toBeGreaterThan(COMPACT_LINES);
    const { container: c } = mount(cases.noHighlight, 'compact');
    expect(all(c, 'line-').map((l) => l.getAttribute('data-testid')).sort()).toEqual(Array.from({ length: COMPACT_LINES }, (_, i) => `line-${i}`));
    cleanup();
    const { container: d } = mount(cases.noHighlight, 'full');
    expect(all(d, 'line-')).toHaveLength(rows.length);
  });
});
