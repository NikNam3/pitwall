// @vitest-environment jsdom
// The sc-card as it renders (SP4.3b spec §10, V18; mockup docs/design/2026-11-12-sp4.3b/sc-card.html, full 45×3, compact
// 26×2; Q5 B; C65, C66, C68). Contract assumed of `ScCard.svelte` (props `WidgetProps<typeof widget>`):
//  - every text line is an element with class `line`; one lead cell, then the columns, one cell between columns;
//  - full: the header line (faint) `COND 3 | ΔPOS 4 | P(GAIN) 7 | −4  0  +4 (9) | REJ 3 | LOSS 5 | RANGE 6` (right-aligned
//    but COND and the strip's labels); the header's COND cell is empty, except while a condition is out
//    (`activeCondition` over `phase`): then it names it (`text.conditions`) in the warning role (`stateRole`); then the SC
//    and VSC rows, the same columns: ΔPOS, P(GAIN), the kit's `DistStrip` (form `gain`, the row's bins, the rows' shared
//    `scaleOf`, zero `{ underBin: 4 }`, lit on the active row), REJ, LOSS (the value right in 4 cells, then the kit
//    `SourceBadge` of the row's loss source in the fifth: `ᶜ`, `ᵈ`, a blank for a session value; an unknown loss its
//    mark right in all 5, no badge), RANGE; the strip is an SVG (no text), an unknown strip the kit's mark left in its
//    9 cells; every unknown cell the kit's `TextCell` (its mark, the reason on hover);
//  - the row of the condition that is out is white bold: its line's colour `rowRole(true)` and its text inside a
//    `<strong>`; the VSC row (the second) carries the kit row band (`bgRowBand`) unless it is the active row;
//  - compact: the two rows alone, COND 3, ΔPOS 4, P(GAIN) 4, REJ 3 (no header, no strip, no LOSS, no RANGE, no band).
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { fitCell } from '../../kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { sourceTitle } from '../../kit/values/source-badge.ts';
import { role } from '../../theme/index.ts';
// The gallery's cases and fit sizes come from fixtures.ts: only the gallery imports gallery.ts (C69).
import { calibrationSource, call, cases, computed, defaultSource, fit, racing, row, scGreen, vscGreen } from './fixtures.ts';
import ScCard from './ScCard.svelte';
import { widget } from './widget.ts';

afterEach(cleanup);

type Data = (typeof cases)[keyof typeof cases];
type Size = { mode: string; cols: number; rows: number };
const SIZES = { compact: { mode: 'compact', cols: 26, rows: 2 }, full: { mode: 'full', cols: 45, rows: 3 } } as const;

function show(data: Data | Record<string, unknown>, mode: keyof typeof SIZES | Size): HTMLElement {
  const size = typeof mode === 'string' ? SIZES[mode] : mode;
  return render(InPanel, {
    component: ScCard as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data,
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
/** The header line of the full sheet: the one that carries REJ. */
const headerLine = (c: HTMLElement): HTMLElement | undefined => lineElements(c).find((e) => (e.textContent ?? '').includes('REJ'));
/** The body line of a condition (never the header, which may start with the active condition). */
const rowLine = (c: HTMLElement, cond: 'SC' | 'VSC'): HTMLElement => {
  const l = lineElements(c).find((e) => !(e.textContent ?? '').includes('REJ') && (e.textContent ?? '').trim().startsWith(`${cond} `));
  if (l === undefined) throw new Error(`no ${cond} row`);
  return l;
};
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
const hovers = (line: HTMLElement): string[] =>
  [line, ...line.querySelectorAll<HTMLElement>('[title]')].map((e) => e.getAttribute('title') ?? '').filter((t) => t !== '');
/** Whether the whole text of `line` is bold: inside one `<strong>` (or the line is one). */
function isBold(line: HTMLElement): boolean {
  const strong = line.closest('strong') ?? line.querySelector('strong');
  return strong !== null && (strong.textContent ?? '').trim() === (line.textContent ?? '').trim();
}
/** The distribution strip of a row, if drawn. */
const stripOf = (line: HTMLElement): SVGSVGElement | null => line.querySelector<SVGSVGElement>('svg.dist-strip');
/** The bars of a strip: their heights and fills. */
const barsOf = (svg: SVGSVGElement): { h: number; fill: string }[] =>
  [...svg.querySelectorAll('rect.bar')].map((r) => ({ h: Number(r.getAttribute('height')), fill: r.getAttribute('fill') ?? '' }));

const right = (t: string, w: number): string => fitCell(t, w, 'right');
/** A LOSS cell: a known value right in 4 cells and its badge mark (a blank without one); an unknown mark right in 5. */
const lossCell = (v: string, mark: string): string => right(v, 4) + (mark === '' ? ' ' : mark);
/** The strip cell as it reads: nothing for a drawn strip (an SVG), the unknown mark left in its 9 cells. */
const DRAWN = '';
const stripMark = (mark: string): string => fitCell(mark, 9);
/** A full row as it reads, trimmed. */
const fullRow = (cond: string, dPos: string, pGain: string, strip: string, rej: string, loss: string, range: string): string =>
  ` ${[fitCell(cond, 3), right(dPos, 4), right(pGain, 7), strip, right(rej, 3), loss, right(range, 6)].join(' ')}`.trim();
/** The full header as it reads, trimmed: the condition that is out (or nothing) in COND. */
const header = (cond = ''): string =>
  ` ${[fitCell(cond, 3), right('ΔPOS', 4), right('P(GAIN)', 7), '−4  0  +4', right('REJ', 3), right('LOSS', 5), right('RANGE', 6)].join(' ')}`.trim();
/** A compact row as it reads, trimmed. */
const compactRow = (cond: string, dPos: string, pGain: string, rej: string): string =>
  ` ${[fitCell(cond, 3), right(dPos, 4), right(pGain, 4), right(rej, 3)].join(' ')}`.trim();

const na = unknownMark.notApplicable;
const pending = unknownMark.insufficientData;

const GREEN_FULL = [
  header(),
  fullRow('SC', '+1.4', '75%', DRAWN, 'P9', lossCell('9.8', 'ᵈ'), 'L12–24'),
  fullRow('VSC', '+0.6', '53%', DRAWN, 'P10', lossCell('13.1', 'ᶜ'), 'L15–24'),
];
const SC_OUT_FULL = [
  header('SC'),
  fullRow('SC', '+1.8', '84%', DRAWN, 'P9', lossCell('9.8', 'ᵈ'), 'L12–24'),
  fullRow('VSC', na, na, stripMark(na), na, right(na, 5), na),
];
const VSC_OUT_FULL = [
  header('VSC'),
  fullRow('SC', na, na, stripMark(na), na, right(na, 5), na),
  fullRow('VSC', '+0.9', '62%', DRAWN, 'P10', lossCell('13.1', 'ᶜ'), 'L15–24'),
];
const UNKNOWN_FULL = [
  header(),
  fullRow('SC', pending, pending, stripMark(pending), pending, right(pending, 5), pending),
  fullRow('VSC', pending, pending, stripMark(pending), pending, right(pending, 5), pending),
];
const GREEN_COMPACT = [compactRow('SC', '+1.4', '75%', 'P9'), compactRow('VSC', '+0.6', '53%', 'P10')];
const SC_OUT_COMPACT = [compactRow('SC', '+1.8', '84%', 'P9'), compactRow('VSC', na, na, na)];

describe('sc-card', () => {
  it('header ΔPOS P(GAIN) −4 0 +4 REJ LOSS RANGE; rows SC +1.4 75% <strip> P9 9.8ᵈ L12–24 and VSC +0.6 53% <strip> P10 13.1ᶜ L15–24', () => {
    const c = show(cases.green, 'full');
    expect(lines(c)).toEqual(GREEN_FULL);
    // the mockup's line, the strip's 9 cells aside: ` SC  +1.4     75% ######### P9  9.8ᵈ L12–24`
    expect(lines(c)[1]).toBe('SC  +1.4     75%   P9  9.8ᵈ L12–24');
    for (const cond of ['SC', 'VSC'] as const) expect(stripOf(rowLine(c, cond)), cond).not.toBeNull();
    // LOSS carries the badge of its source with the source's hover; no other cell is badged
    expect(hovers(rowLine(c, 'SC')).filter((t) => t === sourceTitle(defaultSource))).toHaveLength(1);
    expect(hovers(rowLine(c, 'VSC')).filter((t) => t === sourceTitle(calibrationSource))).toHaveLength(1);
    // green: no condition named, no row lit; the VSC row banded
    expect(colourOf(cellWithText(rowLine(c, 'SC'), 'SC'), c)).toBe('');
    expect(isBold(rowLine(c, 'SC'))).toBe(false);
    expect(rowLine(c, 'VSC').getAttribute('style') ?? '').toContain('bgRowBand');
    // a session-measured loss keeps its badge cell blank, so the columns stay aligned
    cleanup();
    const measured = show({ call: computed(call(row('sc', scGreen, { kind: 'session', sessionShare: 1, parts: '2 stops' }))), phase: racing }, 'full');
    expect(lines(measured)[1]).toBe(fullRow('SC', '+1.4', '75%', DRAWN, 'P9', lossCell('9.8', ''), 'L12–24'));
    // without the session phase no condition is named
    cleanup();
    expect(lines(show({ call: cases.green.call, phase: undefined }, 'full'))[0]).toBe(header());
  });

  it('under a neutralised span with car SC: the header SC in warning, the SC row white bold with its strip lit, the VSC row – in every cell with notApplicable on hover (Q5 B)', () => {
    const c = show(cases.scOut, 'full');
    const head = headerLine(c)!;
    expect((head.textContent ?? '').trim()).toBe(header('SC'));
    expect(colourOf(cellWithText(head, 'SC'), c)).toBe(role('warning'));
    const sc = rowLine(c, 'SC');
    expect(isBold(sc)).toBe(true);
    expect(colourOf(cellWithText(sc, 'SC'), c)).toBe(role('text'));
    const bars = barsOf(stripOf(sc)!);
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) expect(b.fill).toBe(role('ownCar'));
    const vsc = rowLine(c, 'VSC');
    expect(isBold(vsc)).toBe(false);
    expect((vsc.textContent ?? '').trim()).toBe(fullRow('VSC', na, na, stripMark(na), na, right(na, 5), na));
    expect(stripOf(vsc)).toBeNull();
    expect(hovers(vsc).filter((t) => t === unknownReason.notApplicable)).toHaveLength(6);
    expect(hovers(vsc)).not.toContain(sourceTitle(calibrationSource));
    // green: no bar lit
    cleanup();
    const green = show(cases.green, 'full');
    for (const cond of ['SC', 'VSC'] as const) for (const b of barsOf(stripOf(rowLine(green, cond))!)) expect(b.fill, cond).not.toBe(role('ownCar'));
  });

  it('the strips share one scale; a white tick under the zero bin\'s centre', () => {
    const flat = Array(9).fill(1 / 9) as number[];
    const c = show({ call: computed(call(row('sc', scGreen, defaultSource), row('vsc', { ...vscGreen, gainBins: flat }, calibrationSource))), phase: racing }, 'full');
    const sc = stripOf(rowLine(c, 'SC'))!;
    const vsc = stripOf(rowLine(c, 'VSC'))!;
    const tallest = (s: SVGSVGElement): number => Math.max(...barsOf(s).map((b) => b.h));
    // the VSC's flat bins (1/9 each) against the SC's largest (0.286), on one scale
    expect(tallest(vsc) / tallest(sc)).toBeCloseTo(1 / 9 / 0.286, 3);
    for (const s of [sc, vsc]) {
      expect(s.getAttribute('data-form')).toBe('gain');
      expect(s.getAttribute('data-cells')).toBe('9');
      const zero = s.querySelector('line.zero')!;
      expect(zero.getAttribute('data-zero')).toBe('under');
      const width = Number((s.getAttribute('viewBox') ?? '').split(' ')[2]);
      expect(Number(zero.getAttribute('x1'))).toBeCloseTo((width / 9) * 4.5, 6);
      expect(zero.getAttribute('stroke')).toBe(role('text'));
    }
  });

  it('compact: ΔPOS, P(GAIN), REJ', () => {
    const c = show(cases.green, 'compact');
    expect(lines(c)).toEqual(GREEN_COMPACT);
    expect(c.querySelector('svg.dist-strip')).toBeNull();
    expect(headerLine(c)).toBeUndefined();
    for (const cond of ['SC', 'VSC'] as const) expect(rowLine(c, cond).getAttribute('style') ?? '', cond).not.toContain('bgRowBand');
    cleanup();
    const out = show(cases.scOut, 'compact');
    expect(lines(out)).toEqual(SC_OUT_COMPACT);
    expect(isBold(rowLine(out, 'SC'))).toBe(true);
    expect(colourOf(cellWithText(rowLine(out, 'SC'), 'SC'), out)).toBe(role('text'));
    expect(hovers(rowLine(out, 'VSC')).filter((t) => t === unknownReason.notApplicable)).toHaveLength(3);
  });

  it('unknown cells: the kit\'s marks', () => {
    const c = show(cases.unknown, 'full');
    expect(lines(c)).toEqual(UNKNOWN_FULL);
    expect(c.querySelector('svg.dist-strip')).toBeNull();
    for (const l of lines(c)) expect(l).not.toMatch(/[ᶜᵈ]/u);
    for (const cond of ['SC', 'VSC'] as const) {
      const l = rowLine(c, cond);
      expect(hovers(l).filter((t) => t === unknownReason.insufficientData), cond).toHaveLength(6);
      // the marks in the faint role
      expect(colourOf(cellWithText(l, pending), c), cond).toBe(role('textFaint'));
    }
    cleanup();
    expect(lines(show(cases.unknown, 'compact'))).toEqual([compactRow('SC', pending, pending, pending), compactRow('VSC', pending, pending, pending)]);
  });

  it('no sentence in the visible text', () => {
    const token = /^(?:ΔPOS|P\(GAIN\)|REJ|LOSS|RANGE|SC|VSC|[−+]4|0|P\d+|[+−]\d+\.\d|\d+%|\d+\.\d[ᶜᵈ]?|L\d\d–\d\d|[…–])$/u;
    for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
      for (const mode of ['full', 'compact'] as const) {
        const c = show(cases[name], mode);
        for (const t of (c.textContent ?? '').split(/\s+/u).filter((s) => s !== '')) expect(t, `${name} ${mode}`).toMatch(token);
        cleanup();
      }
    }
  });

  it('gallery: the four full and two compact states of sc-card.html (the 4.2 cases replaced)', () => {
    expect(Object.keys(cases)).toEqual(['green', 'scOut', 'vscOut', 'unknown']);
    const states: [keyof typeof cases, keyof typeof SIZES, string[]][] = [
      ['green', 'full', GREEN_FULL],
      ['scOut', 'full', SC_OUT_FULL],
      ['vscOut', 'full', VSC_OUT_FULL],
      ['unknown', 'full', UNKNOWN_FULL],
      ['green', 'compact', GREEN_COMPACT],
      ['scOut', 'compact', SC_OUT_COMPACT],
    ];
    for (const [name, mode, expected] of states) {
      expect(lines(show(cases[name], mode)), `${name} ${mode}`).toEqual(expected);
      cleanup();
    }
    // the fit sizes hold both minimums; every case at every fit size keeps its lines within the columns and rows
    for (const [mode, s] of Object.entries(widget.sizes)) expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
      for (const size of fit) {
        const all = lineElements(show(cases[name], size));
        const at = `${name} at ${size.mode} ${size.cols}x${size.rows}`;
        expect(all.length, at).toBeLessThanOrEqual(size.rows);
        // a drawn strip is 9 cells of SVG beside its line's text
        for (const e of all) {
          const l = e.textContent ?? '';
          expect([...l].length, `${at}: "${l}"`).toBeLessThanOrEqual(size.cols - (stripOf(e) === null ? 0 : 9));
        }
        cleanup();
      }
    }
  });
});
