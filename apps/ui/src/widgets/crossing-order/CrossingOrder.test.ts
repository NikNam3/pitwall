// @vitest-environment jsdom
// The crossing order as it renders (SP4.2 spec §4; mockup docs/design/2026-10-30-sp4a-displays/1-ghost-views.html, full
// 54×9 and compact 20×7; C65, C66, C68). Contract assumed of `CrossingOrder.svelte` (props `WidgetProps<typeof widget>`):
//  - one block per condition shown, an element with `data-condition` = the condition (`green`, `vsc`, `sc`), in that
//    order; full shows the three side by side, compact one: the condition that is out (`activeCondition` over
//    `data.phase`, by the presentation table), else green;
//  - every text line of a block is an element with class `line`, at most 15 cells wide (P 2 right, DRV 4 left, INT 7
//    right, one cell gap, kit `fitCell`): the title `<condition> <loss><badge>` (wording `text.conditions`, the loss as
//    seconds to one decimal, kit `formatSeconds(ms, 1)`, followed by the kit `SourceBadge`, which carries the source's
//    hover), the header (`text.headers`: P DRV INT), then the order's rows: P the row's `position`, DRV the car code
//    from cars.overview (kit `carCodeById`), INT the row's `intervalMs` (kit `formatGap`);
//  - full shows every row of the order (three either side of the ghost), compact the two rows either side of it;
//  - the ghost row is rendered through the kit `GhostRow` (faint, between two hairlines): our car's code, plain;
//  - the rows directly ahead of and behind the ghost are bold: their text inside a `strong` element; no other row is;
//  - our cars' codes (session.info, kit `ourCars`) take the own-car role;
//  - the title of the condition that is out is white bold: inside a `strong`, in the `text` role; no other title is bold;
//  - the ghost row's text is a `.line` too, inside `GhostRow`'s `[data-ghost-row]`;
//  - an unknown loss is the kit's unknown mark with the reason on hover (kit `TextCell`) and no badge; an unknown order
//    shows the title and the header, no row and no ghost row, and the reason on hover (on a `.line` below the header).
// Contract assumed of `text.ts`: `conditions = { green: 'green', vsc: 'VSC', sc: 'SC' }`, `headers = { p: 'P', drv: 'DRV',
// int: 'INT' }`. No sentence anywhere (K6).
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { fitCell } from '../../kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { sourceTitle } from '../../kit/values/source-badge.ts';
import { role } from '../../theme/index.ts';
// The gallery's cases and fit sizes come from fixtures.ts: only the gallery imports gallery.ts (C69).
import { cases, fit, LOSSES } from './fixtures.ts';
import CrossingOrder from './CrossingOrder.svelte';
import * as text from './text.ts';
import { widget } from './widget.ts';

afterEach(cleanup);

type CaseName = keyof typeof cases;
type Size = { mode: string; cols: number; rows: number };
const SIZES = { compact: { mode: 'compact', cols: 20, rows: 7 }, full: { mode: 'full', cols: 54, rows: 9 } } as const;
/** One block's width in cells: P 2, DRV 4, INT 7, two gaps. */
const BLOCK_COLS = 15;

function show(name: CaseName, mode: keyof typeof SIZES | Size): HTMLElement {
  const size = typeof mode === 'string' ? SIZES[mode] : mode;
  return render(InPanel, {
    component: CrossingOrder as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: cases[name],
      options: {},
      size: { ...size, px: { width: size.cols * 8, height: size.rows * 16 }, dpr: 1 },
      link: {},
    },
  }).container;
}

/** The condition blocks, in order. */
const blocks = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-condition]')];
const block = (c: HTMLElement, condition: string): HTMLElement => {
  const b = c.querySelector<HTMLElement>(`[data-condition="${condition}"]`);
  if (b === null) throw new Error(`no block ${condition}`);
  return b;
};
/** Every `.line` element of a scope. */
const lineElements = (s: HTMLElement): HTMLElement[] => [...s.querySelectorAll<HTMLElement>('.line')];
/** The non-blank lines as they read, trimmed. */
const lines = (s: HTMLElement): string[] => lineElements(s).map((e) => (e.textContent ?? '').trim()).filter((t) => t !== '');
/** The line whose trimmed text contains `code` as a word. */
const lineWith = (s: HTMLElement, code: string): HTMLElement | undefined =>
  lineElements(s).find((e) => (e.textContent ?? '').split(/\s+/).includes(code));
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
/** The hover texts on `el` and inside it. */
const hovers = (el: HTMLElement): string[] => [el, ...el.querySelectorAll<HTMLElement>('[title]')].map((e) => e.getAttribute('title') ?? '').filter((t) => t !== '');
/** Whether a line's whole text is bold: inside a `strong` holding all of it. */
const bold = (line: HTMLElement): boolean =>
  [...line.querySelectorAll('strong'), line.closest('strong')].some((s) => s !== null && (s.textContent ?? '').trim() === (line.textContent ?? '').trim());

/** An order row as it reads: P, DRV, INT in their cells, trimmed. */
const row = (p: string, code: string, int: string): string =>
  [fitCell(p, 2, 'right'), fitCell(code, 4, 'left'), fitCell(int, 7, 'right')].join(' ').trim();
const header = [fitCell(text.headers.p, 2, 'right'), fitCell(text.headers.drv, 4, 'left'), fitCell(text.headers.int, 7, 'right')].join(' ').trim();

describe('the crossing order at its gallery cases', () => {
  it('the gallery has the cases the task names: green (first), a VSC and an SC out, unknown', () => {
    expect(Object.keys(cases)).toEqual(expect.arrayContaining(['green', 'vscOut', 'scOut', 'unknown']));
    expect(Object.keys(cases)[0]).toBe('green');
  });

  it('the gallery fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });

  it('every case at every fit size keeps each block\'s lines within a block\'s width, the blocks within the columns and the lines within the rows', () => {
    for (const name of Object.keys(cases) as CaseName[]) {
      for (const size of fit) {
        const c = show(name, size);
        const bs = blocks(c);
        const where = `${name} at ${size.mode} ${size.cols}x${size.rows}`;
        expect(bs.length * BLOCK_COLS + Math.max(0, bs.length - 1) * 3 + 1, where).toBeLessThanOrEqual(size.cols);
        for (const b of bs) {
          const all = lineElements(b).map((e) => e.textContent ?? '');
          expect(all.length, where).toBeLessThanOrEqual(size.rows);
          for (const l of all) expect(l.length, `${where}: "${l}"`).toBeLessThanOrEqual(BLOCK_COLS);
        }
        cleanup();
      }
    }
  });
});

describe('full (54×9): green running, the mockup', () => {
  it('shows three blocks: green, VSC, SC', () => {
    expect(blocks(show('green', 'full')).map((b) => b.dataset['condition'])).toEqual(['green', 'vsc', 'sc']);
  });

  it('titles each block with its condition, its loss and the loss\'s badge', () => {
    const c = show('green', 'full');
    expect(['green', 'vsc', 'sc'].map((k) => lines(block(c, k))[0])).toEqual(['green 20.3', 'VSC 13.1ᶜ', 'SC 9.8ᵈ']);
  });

  it('gives each title the badge\'s hover: the loss\'s source', () => {
    const c = show('green', 'full');
    for (const k of ['green', 'vsc', 'sc'] as const) {
      expect(hovers(lineElements(block(c, k))[0]!), k).toContain(sourceTitle(LOSSES[k].source));
    }
  });

  it('shows the green order: the header, then three cars either side of the ghost', () => {
    expect(lines(block(show('green', 'full'), 'green'))).toEqual([
      'green 20.3',
      header,
      row('9', 'GAS', '+3.684'),
      row('10', 'HAD', '+4.593'),
      row('11', 'HUL', '+2.779'),
      row('12', 'KUH', '+0.612'),
      row('13', 'OCO', '+1.496'),
      row('14', 'STR', '+3.573'),
      row('15', 'BEA', '+3.569'),
    ]);
  });

  it('shows the VSC and the SC orders', () => {
    const c = show('green', 'full');
    expect(lines(block(c, 'vsc')).slice(2)).toEqual([
      row('7', 'ALO', '+3.573'), row('8', 'LIN', '+4.079'), row('9', 'GAS', '+3.684'), row('10', 'KUH', '+0.458'),
      row('11', 'HAD', '+4.135'), row('12', 'HUL', '+2.779'), row('13', 'OCO', '+2.396'),
    ]);
    expect(lines(block(c, 'sc')).slice(2)).toEqual([
      row('6', 'RUS', '+1.304'), row('7', 'ALO', '+3.573'), row('8', 'LIN', '+4.079'), row('9', 'KUH', '+0.844'),
      row('10', 'GAS', '+2.840'), row('11', 'HAD', '+4.593'), row('12', 'HUL', '+2.779'),
    ]);
  });

  it('draws the ghost row through GhostRow: between two hairlines, faint, our code plain', () => {
    const c = show('green', 'full');
    for (const k of ['green', 'vsc', 'sc']) {
      const b = block(c, k);
      const ghosts = [...b.querySelectorAll<HTMLElement>('[data-ghost-row]')];
      expect(ghosts, k).toHaveLength(1);
      expect(b.querySelectorAll('[data-hairline]'), k).toHaveLength(2);
      expect(ghosts[0]?.textContent ?? '', k).toContain('KUH');
      expect(colourOf(cellWithText(ghosts[0]!, 'KUH'), c), k).toBe(role('textFaint'));
    }
  });

  it('makes the rows directly ahead of and behind the ghost bold, and no other row', () => {
    const g = block(show('green', 'full'), 'green');
    expect(bold(lineWith(g, 'HUL')!)).toBe(true);
    expect(bold(lineWith(g, 'OCO')!)).toBe(true);
    for (const code of ['GAS', 'HAD', 'STR', 'BEA', 'KUH']) expect(bold(lineWith(g, code)!), code).toBe(false);
  });

  it('makes the neighbours bold in each condition: GAS and HAD under VSC, LIN and GAS under SC', () => {
    const c = show('green', 'full');
    expect(['ALO', 'LIN', 'GAS', 'HAD', 'HUL', 'OCO'].filter((code) => bold(lineWith(block(c, 'vsc'), code)!))).toEqual(['GAS', 'HAD']);
    expect(['RUS', 'ALO', 'LIN', 'GAS', 'HAD', 'HUL'].filter((code) => bold(lineWith(block(c, 'sc'), code)!))).toEqual(['LIN', 'GAS']);
  });

  it('shows our teammate\'s code in the own-car colour, a rival\'s in the text colour', () => {
    const c = show('green', 'full');
    const vsc = block(c, 'vsc');
    expect(colourOf(cellWithText(lineWith(vsc, 'LIN')!, 'LIN'), c)).toBe(role('ownCar'));
    expect(colourOf(cellWithText(lineWith(vsc, 'ALO')!, 'ALO'), c)).toBe('');
  });

  it('makes no title bold while green runs', () => {
    const c = show('green', 'full');
    for (const k of ['green', 'vsc', 'sc']) expect(bold(lineElements(block(c, k))[0]!), k).toBe(false);
  });
});

describe('full (54×9): a neutralisation', () => {
  it('under a VSC makes the VSC title white bold, and no other', () => {
    const c = show('vscOut', 'full');
    const title = lineElements(block(c, 'vsc'))[0]!;
    expect(bold(title)).toBe(true);
    expect(colourOf(cellWithText(title, 'VSC'), c)).toBe(role('text'));
    for (const k of ['green', 'sc']) expect(bold(lineElements(block(c, k))[0]!), k).toBe(false);
  });

  it('under an SC makes the SC title white bold, and no other', () => {
    const c = show('scOut', 'full');
    const title = lineElements(block(c, 'sc'))[0]!;
    expect(bold(title)).toBe(true);
    expect(colourOf(cellWithText(title, 'SC'), c)).toBe(role('text'));
    for (const k of ['green', 'vsc']) expect(bold(lineElements(block(c, k))[0]!), k).toBe(false);
  });

  it('keeps the three blocks in their order', () => {
    expect(blocks(show('scOut', 'full')).map((b) => b.dataset['condition'])).toEqual(['green', 'vsc', 'sc']);
  });
});

describe('compact (20×7)', () => {
  it('shows green while green runs, two rows either side of the ghost', () => {
    const c = show('green', 'compact');
    expect(blocks(c).map((b) => b.dataset['condition'])).toEqual(['green']);
    expect(lines(block(c, 'green'))).toEqual([
      'green 20.3',
      header,
      row('10', 'HAD', '+4.593'),
      row('11', 'HUL', '+2.779'),
      row('12', 'KUH', '+0.612'),
      row('13', 'OCO', '+1.496'),
      row('14', 'STR', '+3.573'),
    ]);
  });

  it('shows the VSC under a VSC, its title white bold', () => {
    const c = show('vscOut', 'compact');
    expect(blocks(c).map((b) => b.dataset['condition'])).toEqual(['vsc']);
    expect(lines(block(c, 'vsc'))).toEqual([
      'VSC 13.1ᶜ',
      header,
      row('8', 'LIN', '+4.079'),
      row('9', 'GAS', '+3.684'),
      row('10', 'KUH', '+0.458'),
      row('11', 'HAD', '+4.135'),
      row('12', 'HUL', '+2.779'),
    ]);
    expect(bold(lineElements(block(c, 'vsc'))[0]!)).toBe(true);
  });

  it('shows the SC under an SC', () => {
    const c = show('scOut', 'compact');
    expect(blocks(c).map((b) => b.dataset['condition'])).toEqual(['sc']);
    expect(lines(block(c, 'sc')).slice(2)).toEqual([
      row('7', 'ALO', '+3.573'), row('8', 'LIN', '+4.079'), row('9', 'KUH', '+0.844'), row('10', 'GAS', '+2.840'), row('11', 'HAD', '+4.593'),
    ]);
  });

  it('keeps the ghost row and the bold neighbours', () => {
    const b = block(show('green', 'compact'), 'green');
    expect(b.querySelectorAll('[data-ghost-row]')).toHaveLength(1);
    expect(b.querySelectorAll('[data-hairline]')).toHaveLength(2);
    expect(['HAD', 'HUL', 'OCO', 'STR'].filter((code) => bold(lineWith(b, code)!))).toEqual(['HUL', 'OCO']);
  });
});

describe('unknown losses and orders', () => {
  const reason = unknownReason.insufficientData;

  it('keeps the titles, the loss the unknown mark with the reason on hover', () => {
    const c = show('unknown', 'full');
    const titles = ['green', 'vsc', 'sc'].map((k) => lineElements(block(c, k))[0]!);
    expect(titles.map((t) => (t.textContent ?? '').trim())).toEqual(
      [text.conditions.green, text.conditions.vsc, text.conditions.sc].map((w) => `${w} ${unknownMark.insufficientData}`),
    );
    for (const t of titles) expect(hovers(t)).toContain(reason);
  });

  it('shows the header, no row and no ghost row, with the reason on hover', () => {
    const c = show('unknown', 'full');
    for (const k of ['green', 'vsc', 'sc']) {
      const b = block(c, k);
      expect(lines(b)[1], k).toBe(header);
      expect(lines(b).slice(2).filter((l) => /[A-Z]{3}|\+/.test(l)), k).toEqual([]);
      expect(b.querySelectorAll('[data-ghost-row]'), k).toHaveLength(0);
      const rest = lineElements(b).slice(2);
      expect(rest.flatMap(hovers), k).toContain(reason);
    }
  });

  it('shows the same in compact', () => {
    const b = block(show('unknown', 'compact'), 'green');
    expect(lines(b).slice(0, 2)).toEqual([`${text.conditions.green} ${unknownMark.insufficientData}`, header]);
    expect(b.querySelectorAll('[data-ghost-row]')).toHaveLength(0);
  });
});
