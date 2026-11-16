// @vitest-environment jsdom
// The Box call as it renders (SP4.3d spec §6.3, V18 reworked; mockup docs/design/2026-11-16-sp4.3d/sc-card.html, gen.mjs
// `block`, `compactBlock`: full 58×23, compact 26×3; C65, C66, C68). The old SC/VSC sheet (one row per condition, gain
// strip, LOSS, RANGE) is gone with the old `ScCall` shape; its render tests are deleted with it.
// Contract assumed of `ScCard.svelte` (props `WidgetProps<typeof widget>`, data `call`, `phase`):
//  - every text line is an element with class `line`; one lead cell, then the columns, one cell between columns;
//  - full: per block of `buildBlocks(call.value, activeCondition(phase))`, in order, a header line, then one line per
//    option; one blank `.line` between two blocks (green: 7 + 1 + 7 + 1 + 7 = 23 lines);
//    - the header line in the faint role (an inline colour): LABEL 6 (left: the block's `label`, `SC`, or `SC ~4` while
//      out, then in the warning role) | `E[POS]` 9 | `ΔPOS` 6 | `P(GAIN)` 7 | `REJ` 4 (right) | the places strip's header
//      over its cells: `P1` at the first, `P10` at the tenth, `P20` ending at the last (gen.mjs `placesHeader`);
//    - an option line: LABEL 6 (`stay`, `box S`) | E[POS] 9 | ΔPOS 6 | P(GAIN) 7 | REJ 4 (right) | the kit's `DistStrip`
//      (form `places`, the option's pmf, the block's `scale`, `ourPlace`, lit on the best row); an unknown strip blank;
//      a ΔPOS cell in its `dPosRole`; an unknown cell the kit's `TextCell` (its mark, the reason on hover);
//    - the best row white bold: its line's colour `bestRole(true)` and its text inside a `<strong>`;
//    - a "no set" line: its label and the words `no set` (right in E[POS]) in the faint role, no hover, the rest blank;
//  - compact: per block of `buildCompact(call.value, activeCondition(phase))` one line: LABEL 6 (left, warning while
//    out) | the option 6 (left) | ΔPOS 6 | REJ 4 (right); no header, no strip; a lit row white bold (`bestRole(true)`);
//  - no block (`blocks: []`, the call does not apply): one line, the kit's notApplicable mark (`TextCell`), in both modes;
//  - numbers and short labels only, no sentence.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { fitCell } from '../../kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
// The gallery's cases and fit sizes come from fixtures.ts: only the gallery imports gallery.ts (C69).
import { block, call, cases, computed, fit, OUR_PLACE, PLACES, placeDist, racing, SC } from './fixtures.ts';
import ScCard from './ScCard.svelte';
import { widget } from './widget.ts';

afterEach(cleanup);

type Data = (typeof cases)[keyof typeof cases];
type Size = { mode: string; cols: number; rows: number };
const SIZES = { compact: { mode: 'compact', cols: 26, rows: 3 }, full: { mode: 'full', cols: 58, rows: 23 } } as const;

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
const textOf = (e: Element): string => (e.textContent ?? '').trim();
/** The non-blank lines as they read, trimmed. */
const lines = (c: HTMLElement): string[] => lineElements(c).map(textOf).filter((t) => t !== '');
/** The header lines of the full sheet: those that carry REJ. */
const headerLines = (c: HTMLElement): HTMLElement[] => lineElements(c).filter((e) => textOf(e).includes('REJ'));
/** The option lines of the `n`th block (0-based), in order. */
function blockLines(c: HTMLElement, n: number): HTMLElement[] {
  const all = lineElements(c);
  const heads = all.map((e, i) => (textOf(e).includes('REJ') ? i : -1)).filter((i) => i >= 0);
  const from = heads[n]! + 1;
  const to = heads[n + 1] ?? all.length;
  return all.slice(from, to).filter((e) => textOf(e) !== '');
}
/** The innermost element of `scope` whose own text, trimmed, is `t`. */
const cellWithText = (scope: HTMLElement, t: string): HTMLElement | undefined =>
  [...scope.querySelectorAll<HTMLElement>('*')].reverse().find((e) => textOf(e) === t);
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
  return strong !== null && textOf(strong) === textOf(line);
}
/** The places strip of a line, if drawn. */
const stripOf = (line: HTMLElement): SVGSVGElement | null => line.querySelector<SVGSVGElement>('svg.dist-strip');
/** The bars of a strip: their heights and fills. */
const barsOf = (svg: SVGSVGElement): { h: number; fill: string }[] =>
  [...svg.querySelectorAll('rect.bar')].map((r) => ({ h: Number(r.getAttribute('height')), fill: r.getAttribute('fill') ?? '' }));

const right = (t: string, w: number): string => fitCell(t, w, 'right');
/** The strip's header over 20 places (gen.mjs `placesHeader`). */
const PLACES_HEADER = 'P1       P10     P20';
/** A full header as it reads, trimmed. */
const header = (label: string): string =>
  ` ${[fitCell(label, 6), right('E[POS]', 9), right('ΔPOS', 6), right('P(GAIN)', 7), right('REJ', 4), PLACES_HEADER].join(' ')}`.trim();
/** A full option line as it reads, trimmed: the strip is an SVG (no text). */
const opt = (label: string, ePos: string, dPos = '', pGain = '', rej = ''): string =>
  ` ${[fitCell(label, 6), right(ePos, 9), right(dPos, 6), right(pGain, 7), right(rej, 4)].join(' ')}`.trim();
/** A compact line as it reads, trimmed. */
const compactLine = (label: string, option: string, dPos: string, rej: string): string =>
  ` ${fitCell(label, 6)}${fitCell(option, 6)} ${right(dPos, 6)} ${right(rej, 4)}`.trim();

const SC_BLOCK = [
  opt('stay', '8.03±.07', '', '', 'P8'),
  opt('box S', '8.51±.07', '−0.48', '35%', 'P11'),
  opt('box M', 'no set'),
  opt('box H', '7.31±.07', '+0.72', '54%', 'P10'),
  opt('box I', '12.75±.07', '−4.72', '3%', 'P11'),
  opt('box W', 'no set'),
];
const VSC_BLOCK = [
  opt('stay', '7.97±.07', '', '', 'P8'),
  opt('box S', '8.83±.07', '−0.86', '30%', 'P12'),
  opt('box M', 'no set'),
  opt('box H', '7.63±.07', '+0.34', '48%', 'P11'),
  opt('box I', '13.24±.07', '−5.27', '2%', 'P12'),
  opt('box W', 'no set'),
];
const GREEN_BLOCK = [
  opt('stay', '7.94±.07', '', '', 'P8'),
  opt('box S', '9.79±.07', '−1.85', '18%', 'P15'),
  opt('box M', 'no set'),
  opt('box H', '8.72±.07', '−0.78', '31%', 'P15'),
  opt('box I', '14.52±.07', '−6.57', '2%', 'P15'),
  opt('box W', 'no set'),
];
const GREEN_FULL = [header('SC'), ...SC_BLOCK, header('VSC'), ...VSC_BLOCK, header('GREEN'), ...GREEN_BLOCK];
const SC_OUT_FULL = [header('SC ~4'), ...SC_BLOCK];
const VSC_OUT_FULL = [header('VSC ~2'), ...VSC_BLOCK];
const GREEN_COMPACT = [compactLine('SC', 'box H', '+0.72', 'P10'), compactLine('VSC', 'box H', '+0.34', 'P11'), compactLine('GREEN', 'box H', '−0.78', 'P15')];
const SC_OUT_COMPACT = [compactLine('SC ~4', 'box H', '+0.72', 'P10')];
const NOT_APPLICABLE = [unknownMark.notApplicable];

describe('Box call', () => {
  it('green running, full: SC, VSC, GREEN blocks, six answers each, the mockup\'s lines', () => {
    const c = show(cases.green, 'full');
    expect(lines(c)).toEqual(GREEN_FULL);
    // the mockup's first lines, the strips aside
    expect(lines(c)[0]).toBe('SC        E[POS]   ΔPOS P(GAIN)  REJ P1       P10     P20');
    expect(lines(c)[4]).toBe('box H   7.31±.07  +0.72     54%  P10');
    // a blank line between two blocks: 23 lines in all
    expect(lineElements(c)).toHaveLength(23);
    // the header lines faint, no condition out
    for (const [i, head] of headerLines(c).entries()) {
      expect(colourOf(cellWithText(head, 'E[POS]'), c), `header ${i}`).toBe(role('textFaint'));
      expect(colourOf(cellWithText(head, ['SC', 'VSC', 'GREEN'][i]!), c), `header ${i}`).toBe(role('textFaint'));
    }
    // every known option draws its places strip, our place now under it; "no set" has none
    for (let b = 0; b < 3; b++) {
      for (const [i, line] of blockLines(c, b).entries()) {
        const noSet = i === 2 || i === 5;
        const svg = stripOf(line);
        expect(svg === null, `block ${b} row ${i}`).toBe(noSet);
        if (svg === null) continue;
        expect([svg.getAttribute('data-form'), svg.getAttribute('data-cells')]).toEqual(['places', String(PLACES)]);
        const width = Number((svg.getAttribute('viewBox') ?? '').split(' ')[2]);
        const ours = svg.querySelector('rect.our-place')!;
        expect(Number(ours.getAttribute('x')) / width, `block ${b} row ${i}`).toBeCloseTo((OUR_PLACE - 1) / PLACES, 9);
      }
    }
  });

  it('the best row per block white bold with its strip lit (SC and VSC box H, GREEN stay); the others not', () => {
    const c = show(cases.green, 'full');
    const bestAt = [3, 3, 0];
    for (let b = 0; b < 3; b++) {
      for (const [i, line] of blockLines(c, b).entries()) {
        const best = i === bestAt[b];
        const label = textOf(line).split(/\s{2,}/u)[0]!;
        expect(isBold(line), `block ${b} ${label}`).toBe(best);
        if (best) expect(colourOf(cellWithText(line, label), c), `block ${b} ${label}`).toBe(role('ownCar'));
        const svg = stripOf(line);
        if (svg === null) continue;
        for (const bar of barsOf(svg)) expect(bar.fill === role('ownCar'), `block ${b} ${label}`).toBe(best);
      }
    }
  });

  it('the strips of a block share one scale', () => {
    const c = show(cases.green, 'full');
    const [stay, , , , boxI] = blockLines(c, 0);
    const tallest = (s: SVGSVGElement): number => Math.max(...barsOf(s).map((b) => b.h));
    // the fixture's pmfs: stay at 7.61 (1.6/1.9), box I at 12.4 (1.7/2.0)
    const ratio = Math.max(...placeDist(12.4, 1.7, 2.0)) / Math.max(...placeDist(7.61, 1.6, 1.9));
    expect(tallest(stripOf(boxI!)!) / tallest(stripOf(stay!)!)).toBeCloseTo(ratio, 6);
  });

  it('no set: the label and "no set" faint, no hover, no strip', () => {
    const c = show(cases.green, 'full');
    for (let b = 0; b < 3; b++) {
      for (const i of [2, 5]) {
        const line = blockLines(c, b)[i]!;
        expect(colourOf(cellWithText(line, 'no set'), c), `block ${b} row ${i}`).toBe(role('textFaint'));
        expect(colourOf(cellWithText(line, i === 2 ? 'box M' : 'box W'), c), `block ${b} row ${i}`).toBe(role('textFaint'));
        expect(hovers(line), `block ${b} row ${i}`).toEqual([]);
        expect(isBold(line)).toBe(false);
      }
    }
  });

  it('a ΔPOS below −1 place amber (box I; GREEN box S too); the others inherit', () => {
    const c = show(cases.green, 'full');
    const sc = blockLines(c, 0);
    expect(colourOf(cellWithText(sc[4]!, '−4.72'), c)).toBe(role('warning'));
    expect(colourOf(cellWithText(sc[1]!, '−0.48'), c)).toBe('');
    const green = blockLines(c, 2);
    expect(colourOf(cellWithText(green[1]!, '−1.85'), c)).toBe(role('warning'));
    expect(colourOf(cellWithText(green[3]!, '−0.78'), c)).toBe('');
  });

  it('SC out: its block alone, the header SC ~4 in warning, GREEN hidden', () => {
    const c = show(cases.scOut, 'full');
    expect(lines(c)).toEqual(SC_OUT_FULL);
    expect(lineElements(c)).toHaveLength(7);
    const [head] = headerLines(c);
    expect(colourOf(cellWithText(head!, 'SC ~4'), c)).toBe(role('warning'));
    // the best row (box H) white bold
    expect(isBold(blockLines(c, 0)[3]!)).toBe(true);
    // without the session phase no condition is out: the name alone, not amber
    cleanup();
    const bare = show({ call: cases.scOut.call, phase: undefined }, 'full');
    expect(lines(bare)[0]).toBe(header('SC'));
    expect(colourOf(cellWithText(headerLines(bare)[0]!, 'SC'), bare)).toBe(role('textFaint'));
  });

  it('VSC out: its block alone, the header VSC ~2 in warning', () => {
    const c = show(cases.vscOut, 'full');
    expect(lines(c)).toEqual(VSC_OUT_FULL);
    const [head] = headerLines(c);
    expect(colourOf(cellWithText(head!, 'VSC ~2'), c)).toBe(role('warning'));
  });

  it('compact: per condition the best box option, its ΔPOS and rejoin; white where it beats staying out', () => {
    const c = show(cases.green, 'compact');
    expect(lines(c)).toEqual(GREEN_COMPACT);
    expect(c.querySelector('svg.dist-strip')).toBeNull();
    expect(headerLines(c)).toEqual([]);
    const [sc, vsc, green] = lineElements(c);
    for (const l of [sc!, vsc!]) {
      expect(isBold(l), textOf(l)).toBe(true);
      expect(colourOf(cellWithText(l, 'box H'), c), textOf(l)).toBe(role('ownCar'));
    }
    expect(isBold(green!)).toBe(false);
    expect(colourOf(cellWithText(green!, 'box H'), c)).toBe('');
  });

  it('compact, SC out: the SC line alone, SC ~4 in warning', () => {
    const c = show(cases.scOut, 'compact');
    expect(lines(c)).toEqual(SC_OUT_COMPACT);
    const [l] = lineElements(c);
    expect(isBold(l!)).toBe(true);
    expect(colourOf(cellWithText(l!, 'SC ~4'), c)).toBe(role('warning'));
  });

  it('unknown cells: the kit\'s marks with their reason on hover; a blank strip', () => {
    const pending = block('sc', SC);
    pending.options[1] = { ...pending.options[1]!, ePos: { known: false, reason: 'insufficientData' }, positionPmf: { known: false, reason: 'insufficientData' } };
    const c = show({ call: computed(call([pending])), phase: racing }, 'full');
    const s = blockLines(c, 0)[1]!;
    expect(textOf(s)).toBe(opt('box S', unknownMark.insufficientData, '−0.48', '35%', 'P11'));
    expect(stripOf(s)).toBeNull();
    expect(hovers(s)).toEqual([unknownReason.insufficientData]);
    expect(colourOf(cellWithText(s, unknownMark.insufficientData), c)).toBe(role('textFaint'));
  });

  it('a car the call does not apply to: the notApplicable mark, full and compact', () => {
    for (const mode of ['full', 'compact'] as const) {
      const c = show(cases.notApplicable, mode);
      expect(lines(c), mode).toEqual(NOT_APPLICABLE);
      const [l] = lineElements(c);
      expect(hovers(l!), mode).toEqual([unknownReason.notApplicable]);
      expect(colourOf(cellWithText(l!, unknownMark.notApplicable), c), mode).toBe(role('textFaint'));
      cleanup();
    }
  });

  it('no sentence in the visible text', () => {
    const token =
      /^(?:E\[POS\]|ΔPOS|P\(GAIN\)|REJ|P\d+|SC|VSC|GREEN|stay|box|[SMHIW]|no|set|~\d+|\d+\.\d\d±\.\d\d|[+−]\d+\.\d\d|\d+%|[–…])$/u;
    for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
      for (const mode of ['full', 'compact'] as const) {
        const c = show(cases[name], mode);
        for (const t of (c.textContent ?? '').split(/\s+/u).filter((s) => s !== '')) expect(t, `${name} ${mode}`).toMatch(token);
        cleanup();
      }
    }
  });

  it('gallery: green full, SC out, VSC out, compact and compact SC out of sc-card.html, and notApplicable', () => {
    expect(Object.keys(cases)).toEqual(['green', 'scOut', 'vscOut', 'notApplicable']);
    const states: [keyof typeof cases, keyof typeof SIZES, string[]][] = [
      ['green', 'full', GREEN_FULL],
      ['scOut', 'full', SC_OUT_FULL],
      ['vscOut', 'full', VSC_OUT_FULL],
      ['green', 'compact', GREEN_COMPACT],
      ['scOut', 'compact', SC_OUT_COMPACT],
      ['notApplicable', 'full', NOT_APPLICABLE],
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
        // a drawn strip is one cell per place of SVG beside its line's text
        for (const e of all) {
          const l = e.textContent ?? '';
          expect([...l].length, `${at}: "${l}"`).toBeLessThanOrEqual(size.cols - (stripOf(e) === null ? 0 : PLACES));
        }
        cleanup();
      }
    }
  });
});
