// @vitest-environment jsdom
// The sc-card as it renders (SP4.2 spec 4; mockup docs/design/2026-11-07-sp4.2/sc-card.html, full 30×3, compact 26×2;
// C65, C66, C68, K6: no sentence). Contract assumed of `ScCard.svelte` (props `WidgetProps<typeof widget>`):
//  - every text line is an element with class `line`;
//  - full: the sheet's header line (faint) and the SC and VSC rows; one lead cell, then the columns COND 3 (left),
//    REJOIN 6, LOSS 6, GAIN 6 (right), two cells between columns; the header's COND cell is empty, except while a
//    condition is out (`activeCondition` of `presentation.ts` over `phase`): then it names it (`text.conditions`), in the
//    warning role (`stateRole`) — the shell header has no slot for a widget's state (as tyre-life-bar's first line);
//  - LOSS and GAIN: the value right-aligned in 5 cells, then the kit `SourceBadge` of the row's loss source in the sixth
//    (no mark for a session value, the cell kept blank; `ᶜ`, `ᵈ`), the badge carrying the source's hover; an unknown
//    value shows the kit's unknown mark (kit `TextCell`, the reason on hover) and no badge;
//  - the row of the condition that is out is white bold: its line's colour `rowRole(true)` and its text inside a
//    `<strong>`; the VSC row (the second) carries the kit row band (`bgRowBand`) unless it is the active row;
//  - compact: the two rows alone, COND 3, REJOIN 3, GAIN 6 (no header, no LOSS, no band); the active row white bold.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { fitCell } from '../../kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { sourceTitle } from '../../kit/values/source-badge.ts';
import { role } from '../../theme/index.ts';
// The gallery's cases and fit sizes come from fixtures.ts: only the gallery imports gallery.ts (C69).
import { calibrationSource, cases, defaultSource, fit } from './fixtures.ts';
import ScCard from './ScCard.svelte';
import { widget } from './widget.ts';

afterEach(cleanup);

type CaseName = keyof typeof cases;
const SIZES = { compact: { cols: 26, rows: 2 }, full: { cols: 30, rows: 3 } } as const;

function show(name: CaseName, mode: keyof typeof SIZES | { mode: string; cols: number; rows: number }): HTMLElement {
  const size = typeof mode === 'string' ? { mode, ...SIZES[mode] } : mode;
  return render(InPanel, {
    component: ScCard as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: cases[name],
      options: {},
      size: { ...size, px: { width: size.cols * 8, height: size.rows * 16 }, dpr: 1 },
      link: {},
    },
  }).container;
}

/** Every `.line` element. */
const lineElements = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.line')];
/** The non-blank lines as they read, trimmed. */
const lines = (c: HTMLElement): string[] => lineElements(c).map((e) => (e.textContent ?? '').trim()).filter((t) => t !== '');
/** The line that starts with `prefix` (after its lead). */
/** The first body line (never the header, which may start with the active condition) whose text starts with `prefix`. */
const lineStarting = (c: HTMLElement, prefix: string): HTMLElement | undefined =>
  lineElements(c).find((e) => !(e.textContent ?? '').includes('REJOIN') && (e.textContent ?? '').trim().startsWith(`${prefix} `));
/** The header line of the full sheet: the one that carries REJOIN. */
const headerLine = (c: HTMLElement): HTMLElement | undefined => lineElements(c).find((e) => (e.textContent ?? '').includes('REJOIN'));
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
/** The hover texts on `line` and inside it. */
const hovers = (line: HTMLElement): string[] => [line, ...line.querySelectorAll<HTMLElement>('[title]')].map((e) => e.getAttribute('title') ?? '').filter((t) => t !== '');
/** Whether the whole text of `line` is bold: inside one `<strong>` (or the line is one). */
function isBold(line: HTMLElement): boolean {
  const strong = line.closest('strong') ?? line.querySelector('strong');
  return strong !== null && (strong.textContent ?? '').trim() === (line.textContent ?? '').trim();
}

/** A value cell of LOSS or GAIN: the value right in 5 cells, the badge mark (or a blank) in the sixth. */
const valueCell = (v: string, mark = ''): string => fitCell(v, 5, 'right') + (mark === '' ? ' ' : mark);
/** A full row as it reads, trimmed. */
const fullRow = (cond: string, rejoin: string, loss: string, gain: string): string =>
  [fitCell(cond, 3), fitCell(rejoin, 6, 'right'), loss, gain].join('  ').trim();
/** A compact row as it reads, trimmed. */
const compactRow = (cond: string, rejoin: string, gain: string): string => [fitCell(cond, 3), fitCell(rejoin, 3, 'right'), gain].join('  ').trim();

const pending = unknownMark.insufficientData;

describe('the sc-card at its gallery cases', () => {
  it('the gallery has the mockup\'s cases: green (first), SC out, VSC out, unknown', () => {
    expect(Object.keys(cases)).toEqual(expect.arrayContaining(['green', 'scOut', 'vscOut', 'unknown']));
    expect(Object.keys(cases)[0]).toBe('green');
  });

  it('the gallery fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });

  it('every case at every fit size keeps each line within its columns and the lines within its rows', () => {
    for (const name of Object.keys(cases) as CaseName[]) {
      for (const size of fit) {
        const c = show(name, size);
        const all = lineElements(c).map((e) => e.textContent ?? '');
        expect(all.length, `${name} at ${size.mode} ${size.cols}x${size.rows}`).toBeLessThanOrEqual(size.rows);
        for (const l of all) expect([...l].length, `${name} at ${size.cols}x${size.rows}: "${l}"`).toBeLessThanOrEqual(size.cols);
        cleanup();
      }
    }
  });

  it('carries no sentence: only headers, condition names, positions and numbers (K6)', () => {
    for (const name of Object.keys(cases) as CaseName[]) {
      for (const mode of ['full', 'compact'] as const) {
        for (const l of lines(show(name, mode))) expect(l, `${name} ${mode}`).toMatch(/^(?:REJOIN|LOSS|GAIN|VSC|SC|P\d+|[+−]?\d+\.\d[ᶜᵈ]?|[…–]|\s)+$/u);
        cleanup();
      }
    }
  });
});

describe('full (30×3): the mockup', () => {
  it('shows the header REJOIN LOSS GAIN and the SC and VSC rows, the losses and gains badged', () => {
    expect(lines(show('green', 'full'))).toEqual([
      'REJOIN    LOSS    GAIN',
      'SC       P9    9.8ᵈ  +10.5ᵈ',
      'VSC     P10   13.1ᶜ   +7.2ᶜ',
    ]);
  });

  it('builds each row on the columns: COND 3, REJOIN 6, LOSS 6, GAIN 6, two cells apart', () => {
    expect(lines(show('green', 'full')).slice(1)).toEqual([
      fullRow('SC', 'P9', valueCell('9.8', 'ᵈ'), valueCell('+10.5', 'ᵈ')),
      fullRow('VSC', 'P10', valueCell('13.1', 'ᶜ'), valueCell('+7.2', 'ᶜ')),
    ]);
  });

  it('keeps the badge cell blank for a value measured this session, so the columns stay aligned', () => {
    expect(lines(show('measured', 'full')).slice(1)).toEqual(['SC       P9    9.8   +10.5', 'VSC     P10   13.1    +7.2']);
  });

  it('gives every badge the hover of its row\'s source', () => {
    const c = show('green', 'full');
    expect(hovers(lineStarting(c, 'SC')!).filter((t) => t === sourceTitle(defaultSource))).toHaveLength(2);
    expect(hovers(lineStarting(c, 'VSC')!).filter((t) => t === sourceTitle(calibrationSource))).toHaveLength(2);
  });

  it('names no condition in the header and lights no row while green', () => {
    const c = show('green', 'full');
    expect((headerLine(c)?.textContent ?? '').trim()).toBe('REJOIN    LOSS    GAIN');
    for (const cond of ['SC', 'VSC']) {
      expect(isBold(lineStarting(c, cond)!), cond).toBe(false);
      expect(colourOf(cellWithText(lineStarting(c, cond)!, cond), c), cond).toBe('');
    }
  });

  it('names no condition without the session phase', () => {
    const c = show('noPhase', 'full');
    expect((headerLine(c)?.textContent ?? '').trim()).toBe('REJOIN    LOSS    GAIN');
    expect(isBold(lineStarting(c, 'SC')!)).toBe(false);
  });

  it('under the SC: the header names SC in the warning role and the SC row is white bold', () => {
    const c = show('scOut', 'full');
    const header = headerLine(c)!;
    expect((header.textContent ?? '').trim()).toBe('SC   REJOIN    LOSS    GAIN');
    expect(colourOf(cellWithText(header, 'SC'), c)).toBe(role('warning'));
    const sc = lineStarting(c, 'SC')!;
    expect(isBold(sc)).toBe(true);
    expect(colourOf(cellWithText(sc, 'SC'), c)).toBe(role('text'));
    expect(isBold(lineStarting(c, 'VSC')!)).toBe(false);
  });

  it('under the VSC: the header names VSC in the warning role and the VSC row is white bold', () => {
    const c = show('vscOut', 'full');
    const header = headerLine(c)!;
    expect((header.textContent ?? '').trim()).toBe('VSC  REJOIN    LOSS    GAIN');
    expect(colourOf(cellWithText(header, 'VSC'), c)).toBe(role('warning'));
    const vsc = lineStarting(c, 'VSC')!;
    expect(isBold(vsc)).toBe(true);
    expect(colourOf(cellWithText(vsc, 'VSC'), c)).toBe(role('text'));
    expect(isBold(lineStarting(c, 'SC')!)).toBe(false);
  });

  it('keeps the rows\' text while a condition is out', () => {
    expect(lines(show('scOut', 'full')).slice(1)).toEqual(lines(show('green', 'full')).slice(1));
  });

  it('bands the VSC row, except while it is the active row', () => {
    expect(lineStarting(show('green', 'full'), 'VSC')?.getAttribute('style') ?? '').toContain('bgRowBand');
    cleanup();
    expect(lineStarting(show('green', 'full'), 'SC')?.getAttribute('style') ?? '').not.toContain('bgRowBand');
    cleanup();
    expect(lineStarting(show('vscOut', 'full'), 'VSC')?.getAttribute('style') ?? '').not.toContain('bgRowBand');
  });

  it('shows unknown values as the unknown mark with the reason on hover, and no badge', () => {
    const c = show('unknown', 'full');
    expect(lines(c).slice(1)).toEqual([
      fullRow('SC', pending, valueCell(pending), valueCell(pending)),
      fullRow('VSC', pending, valueCell(pending), valueCell(pending)),
    ]);
    for (const l of lines(c)) expect(l).not.toMatch(/[ᶜᵈ]/u);
    const sc = lineStarting(c, 'SC')!;
    expect(hovers(sc).filter((t) => t === unknownReason.insufficientData)).toHaveLength(3);
    expect(hovers(sc)).not.toContain(sourceTitle(defaultSource));
  });
});

describe('compact (26×2)', () => {
  it('shows the rejoin and the gain of each condition, badged, and no header', () => {
    expect(lines(show('green', 'compact'))).toEqual(['SC    P9  +10.5ᵈ', 'VSC  P10   +7.2ᶜ']);
  });

  it('builds each row on the columns: COND 3, REJOIN 3, GAIN 6', () => {
    expect(lines(show('green', 'compact'))).toEqual([
      compactRow('SC', 'P9', valueCell('+10.5', 'ᵈ')),
      compactRow('VSC', 'P10', valueCell('+7.2', 'ᶜ')),
    ]);
  });

  it('puts the source\'s hover on each gain\'s badge', () => {
    const c = show('green', 'compact');
    expect(hovers(lineStarting(c, 'SC')!)).toContain(sourceTitle(defaultSource));
    expect(hovers(lineStarting(c, 'VSC')!)).toContain(sourceTitle(calibrationSource));
  });

  it('under the SC: the SC row is white bold, the VSC row is not', () => {
    const c = show('scOut', 'compact');
    expect(lines(c)).toEqual(['SC    P9  +10.5ᵈ', 'VSC  P10   +7.2ᶜ']);
    expect(isBold(lineStarting(c, 'SC')!)).toBe(true);
    expect(colourOf(cellWithText(lineStarting(c, 'SC')!, 'SC'), c)).toBe(role('text'));
    expect(isBold(lineStarting(c, 'VSC')!)).toBe(false);
  });

  it('shows unknown values as the unknown mark, and no badge', () => {
    expect(lines(show('unknown', 'compact'))).toEqual([
      compactRow('SC', pending, valueCell(pending)),
      compactRow('VSC', pending, valueCell(pending)),
    ]);
  });
});
