// @vitest-environment jsdom
// The undercut card as it renders (SP4.3b spec §9.1, §10, V13; mockup docs/design/2026-11-12-sp4.3b/undercut-card.html,
// full 47×11, compact 26×5; Q2 A; C65, C68). Contract assumed of `UndercutCard.svelte` (props `WidgetProps<typeof widget>`,
// data `undercut` and `cars`):
//  - every line of the card that belongs to a car carries `data-car="<carId>"`: our own line also `data-own="true"`,
//    `data-role="ownCar"` and `data-bold="true"` (white bold, emphasis.ts); in full size every case row also `data-n="<N>"`
//    (one row per case in the topic, in its order: an absent case has no row), in compact one line per car;
//  - the lines run: the rivals with `side` `ahead` in topic (place) order, our line, the rivals `behind` in topic order;
//  - full, per case row the cells `[data-testid="car"]` (the code from `cars.overview`, kit `carCode`; the kit's
//    unknown mark for a car it does not list), `pos` (kit `formatPosition`), `gap` (kit `formatGap(gapMs)`), these three
//    only on the rival's N = 1 row (empty on the others), then `n`, `dgap` (kit `formatSignedSeconds(gainMs, 1)`), `pah`
//    (kit `formatShare(pAhead)`), the gain strip (the kit `DistStrip`, form `gain`: its bins, zero between bins
//    `-UNDERCUT_GAIN_BINS.fromMs / stepMs`, `markAtBin` = `(aheadFromGainMs − fromMs) / stepMs`, one scale over every
//    strip of the card: kit `sharedScale`), `rej` (kit `formatPosition(rejoinPosition)`); our line its code and place;
//    above them the header line (`text.headers`); an unknown value shows the kit's mark (`TextCell`), its reason on hover;
//  - compact: per car one line, its code and place, then per N `[data-testid="dgap-<N>"]` (ΔGAP, empty for an absent
//    case); the headers `text.nHeader`; no strip;
//  - no rival in range: our line alone, its hover `text.noneHover(rangeMs)`;
//  - an unknown `undercut.value`: the kit's mark with its reason on hover, no car line.
import { UNDERCUT_GAIN_BINS, type CarId, type Known, type Undercut, type UndercutCase } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { sharedScale } from '../../kit/dist/dist.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { formatGap, formatPosition, formatShare, formatSignedSeconds } from '../../kit/values/format.ts';
import { ALB, call, cases, FIELD, GAS, HUL, KUH, NO_RIVAL, NOR, OUR_PLACE, PARTIAL, RIVALS_VALUE } from './fixtures.ts';
import * as text from './text.ts';
import UndercutCard from './UndercutCard.svelte';

afterEach(cleanup);

const SIZES = { compact: { cols: 26, rows: 5 }, full: { cols: 47, rows: 11 } } as const;
type Data = (typeof cases)[keyof typeof cases];
type WithValue = Extract<Data, { undercut: unknown }>;

function mount(data: Data, mode: keyof typeof SIZES = 'full'): HTMLElement {
  const size = SIZES[mode];
  return render(InPanel, {
    component: UndercutCard as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 19.6 }, dpr: 1 }, link: {} },
  }).container;
}

const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cell = (row: Element, id: string): string => textOf(row.querySelector(`[data-testid="${id}"]`));
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
const carLines = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-car]')];
/** The cars of the lines in order, one entry per run of lines of one car. */
const carOrder = (c: HTMLElement): string[] =>
  carLines(c).map((e) => e.getAttribute('data-car') ?? '').filter((id, i, a) => i === 0 || a[i - 1] !== id);
const ownLine = (c: HTMLElement): HTMLElement => {
  const own = c.querySelectorAll<HTMLElement>('[data-own="true"]');
  expect(own).toHaveLength(1);
  return own[0]!;
};
const caseRow = (c: HTMLElement, car: CarId, n: number): HTMLElement | null => c.querySelector<HTMLElement>(`[data-car="${car}"][data-n="${n}"]`);
const valueOf = (d: WithValue): Undercut => {
  if (!d.undercut.value.known) throw new Error('no value');
  return d.undercut.value.value;
};
const shown = <T>(v: Known<T>, f: (t: T) => string): string => (v.known ? f(v.value) : unknownMark[v.reason]);
const ZERO_BETWEEN = -UNDERCUT_GAIN_BINS.fromMs / UNDERCUT_GAIN_BINS.stepMs;
const markAtBin = (aheadFromGainMs: number): number => (aheadFromGainMs - UNDERCUT_GAIN_BINS.fromMs) / UNDERCUT_GAIN_BINS.stepMs;
const strips = (el: Element): SVGSVGElement[] => [...el.querySelectorAll<SVGSVGElement>('svg.dist-strip[data-form="gain"]')];
const num = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr));

describe('undercut-card', () => {
  it('rivals ahead, our line (ownCar, bold), rivals behind, in place order', () => {
    for (const mode of ['full', 'compact'] as const) {
      const c = mount(cases.rivals, mode);
      // ALB P6 and NOR P7 ahead, KUH P8, HUL P9 behind; GAS (out of range) absent
      expect(carOrder(c), mode).toEqual([String(ALB), String(NOR), String(KUH), String(HUL)]);
      expect(carLines(c).some((e) => e.getAttribute('data-car') === String(GAS)), mode).toBe(false);
      const own = ownLine(c);
      expect(own.getAttribute('data-car'), mode).toBe(String(KUH));
      expect([own.getAttribute('data-role'), own.getAttribute('data-bold')], mode).toEqual(['ownCar', 'true']);
      expect(textOf(own), mode).toContain('KUH');
      expect(textOf(own), mode).toContain(formatPosition(OUR_PLACE));
      // the rivals are not emphasised as our line is
      for (const e of carLines(c).filter((x) => x !== own)) expect(e.getAttribute('data-role'), mode).not.toBe('ownCar');
      cleanup();
    }
    // the topic's order decides, the display sorts nothing: a reversed side order is shown reversed
    const v = valueOf(cases.rivals);
    const swapped = { ...v, rivals: [v.rivals[1]!, v.rivals[0]!, v.rivals[2]!] };
    const c = mount({ undercut: call(swapped), cars: FIELD });
    expect(carOrder(c)).toEqual([String(NOR), String(ALB), String(KUH), String(HUL)]);
  });

  it('per rival its place and gap (formatGap) on its N = 1 row, then per N: ΔGAP (formatSignedSeconds 1), P(AH) (formatShare), the gain strip (zero between bins) with markAtBin from aheadFromGainMs, REJ', () => {
    const v = RIVALS_VALUE;
    const c = mount(cases.rivals);
    // the header line
    const visible = visibleTexts(c).join(' ');
    for (const h of [text.headers.pos, text.headers.gap, text.headers.n, text.headers.dGap, text.headers.pAhead, text.headers.rej]) expect(visible).toContain(h);
    const codes: Record<number, string> = { [ALB]: 'ALB', [NOR]: 'NOR', [HUL]: 'HUL' };
    for (const r of v.rivals) {
      expect(carLines(c).filter((e) => e.getAttribute('data-car') === String(r.carId))).toHaveLength(r.cases.length);
      for (const k of r.cases) {
        const row = caseRow(c, r.carId, k.n);
        expect(row, `${r.carId} N${k.n}`).not.toBeNull();
        const first = k.n === 1;
        expect(cell(row!, 'car'), `${r.carId} N${k.n}`).toBe(first ? codes[r.carId] : '');
        expect(cell(row!, 'pos'), `${r.carId} N${k.n}`).toBe(first ? formatPosition(r.position) : '');
        expect(cell(row!, 'gap'), `${r.carId} N${k.n}`).toBe(first ? formatGap(r.gapMs) : '');
        expect(cell(row!, 'n')).toBe(String(k.n));
        expect(cell(row!, 'dgap')).toBe(shown(k.gainMs, (g) => formatSignedSeconds(g, 1)));
        expect(cell(row!, 'pah')).toBe(shown(k.pAhead, formatShare));
        expect(cell(row!, 'rej')).toBe(shown(k.rejoinPosition, formatPosition));
        // the gain strip: one cell per bin, zero between bins 7 and 8, the dotted mark at the gap a car ahead must be beaten by
        const [strip, ...more] = strips(row!);
        expect(more).toHaveLength(0);
        expect(strip!.getAttribute('data-cells')).toBe(String(UNDERCUT_GAIN_BINS.count));
        const zero = strip!.querySelector('line.zero');
        expect(zero?.getAttribute('data-zero')).toBe('between');
        const mark = strip!.querySelector('line.mark');
        expect(mark).not.toBeNull();
        // positions in the strip's own units: the mark relative to the zero line is markAtBin relative to the zero bin
        expect(num(mark, 'x1') / num(zero, 'x1'), `${r.carId} N${k.n}`).toBeCloseTo(markAtBin(r.aheadFromGainMs) / ZERO_BETWEEN, 6);
      }
    }
    // a rival ahead's mark lies right of zero, a rival behind's left of it
    const markX = (car: CarId): number => num(strips(caseRow(c, car, 1)!)[0]!.querySelector('line.mark'), 'x1');
    const zeroX = num(strips(caseRow(c, NOR, 1)!)[0]!.querySelector('line.zero'), 'x1');
    expect(markX(NOR)).toBeGreaterThan(zeroX);
    expect(markX(ALB)).toBeGreaterThan(markX(NOR));
    expect(markX(HUL)).toBeLessThan(zeroX);
    cleanup();

    // an absent case has no row (never zero); an unknown value shows the kit's mark with its reason on hover
    const d = mount(cases.partial);
    expect(caseRow(d, HUL, 1)).not.toBeNull();
    expect(caseRow(d, HUL, 2)).toBeNull();
    expect(caseRow(d, HUL, 3)).toBeNull();
    const nor3 = caseRow(d, NOR, 3)!;
    expect(cell(nor3, 'rej')).toBe(unknownMark.insufficientData);
    expect(hovers(nor3.querySelector('[data-testid="rej"]')!)).toContain(unknownReason.insufficientData);
    expect(PARTIAL.rivals.find((r) => r.carId === NOR)!.cases[2]!.rejoinPosition.known).toBe(false);
  });

  it('the gain strips share one scale (sharedScale)', () => {
    const v = RIVALS_VALUE;
    const all: { bins: number[]; heights: number[] }[] = [];
    const c = mount(cases.rivals);
    for (const r of v.rivals) {
      for (const k of r.cases as UndercutCase[]) {
        if (!k.gainBins.known) continue;
        const strip = strips(caseRow(c, r.carId, k.n)!)[0]!;
        all.push({ bins: k.gainBins.value, heights: [...strip.querySelectorAll('rect.bar')].map((b) => num(b, 'height')) });
      }
    }
    expect(all).toHaveLength(9);
    const scale = sharedScale(all.map((s) => s.bins));
    const tallest = Math.max(...all.flatMap((s) => s.heights));
    // every bar's height against the card's tallest is its bin against the shared scale: the rows compare (Q2 A)
    for (const s of all) {
      const nonZero = s.bins.filter((p) => p > 0);
      expect(s.heights).toHaveLength(nonZero.length);
      s.heights.forEach((h, i) => expect(h / tallest).toBeCloseTo(nonZero[i]! / scale, 6));
    }
    // a flatter case's strip stays below full height (each row against its own largest would make every strip full)
    const ownMaxima = all.map((s) => Math.max(...s.heights));
    expect(Math.min(...ownMaxima)).toBeLessThan(tallest);
  });

  it('no rival in range: our line alone, the range on hover', () => {
    for (const mode of ['full', 'compact'] as const) {
      const c = mount(cases.noRival, mode);
      expect(carLines(c), mode).toHaveLength(1);
      const own = ownLine(c);
      expect(textOf(own), mode).toContain('KUH');
      expect(textOf(own), mode).toContain(formatPosition(OUR_PLACE));
      expect(hovers(own), mode).toContain(text.noneHover(NO_RIVAL.rangeMs));
      expect(strips(c), mode).toHaveLength(0);
      cleanup();
    }
    // the hover names the range the call searched (the mockup's `no car within 3.0 s`)
    expect(text.noneHover(3_000)).toContain('3.0 s');
    expect(text.noneHover(2_500)).toContain('2.5 s');
  });

  it('compact: ΔGAP per N, one line per rival', () => {
    const v = RIVALS_VALUE;
    const c = mount(cases.rivals, 'compact');
    expect(carLines(c)).toHaveLength(v.rivals.length + 1);
    expect(c.querySelectorAll('[data-n]')).toHaveLength(0);
    expect(strips(c)).toHaveLength(0);
    const visible = visibleTexts(c).join(' ');
    for (const n of [1, 2, 3] as const) expect(visible).toContain(text.nHeader[n]);
    for (const r of v.rivals) {
      const line = c.querySelector<HTMLElement>(`[data-car="${r.carId}"]`)!;
      expect(textOf(line)).toContain(formatPosition(r.position));
      for (const k of r.cases) expect(cell(line, `dgap-${k.n}`), `${r.carId} N${k.n}`).toBe(shown(k.gainMs, (g) => formatSignedSeconds(g, 1)));
    }
    // our line: code and place, no ΔGAP
    const own = ownLine(c);
    expect(textOf(own)).toBe(`KUH ${formatPosition(OUR_PLACE)}`);
    cleanup();
    // an absent case leaves its cell empty
    const d = mount(cases.partial, 'compact');
    const hul = d.querySelector<HTMLElement>(`[data-car="${HUL}"]`)!;
    expect(cell(hul, 'dgap-1')).not.toBe('');
    expect([cell(hul, 'dgap-2'), cell(hul, 'dgap-3')]).toEqual(['', '']);
  });

  it('notApplicable (outside the race, under a neutralisation, in the pit lane): the kit\'s mark with the reason', () => {
    // `undercut` publishes the whole value `unknown('notApplicable')` in each of the three (Task 7 row 10)
    expect(cases.notApplicable.undercut.value).toEqual({ known: false, reason: 'notApplicable' });
    for (const mode of ['full', 'compact'] as const) {
      const c = mount(cases.notApplicable, mode);
      expect(visibleTexts(c), mode).toContain(unknownMark.notApplicable);
      expect(hovers(c.querySelector('[title]') ?? c), mode).toContain(unknownReason.notApplicable);
      expect(carLines(c), mode).toHaveLength(0);
      expect(strips(c), mode).toHaveLength(0);
      cleanup();
    }
  });

  it('no sentence in the visible text', () => {
    // numbers, shapes, headers and codes only (memory "no explaining text"); hovers may be phrases
    const sentence = /(?:\b[a-z]{2,}\b[\s,]+){3}\b[a-z]{2,}\b/;
    for (const [name, data] of Object.entries(cases) as [string, Data][]) {
      if (!('undercut' in data)) continue;
      for (const mode of ['full', 'compact'] as const) {
        const c = mount(data, mode);
        const texts = visibleTexts(c);
        expect(texts.length, `${name} ${mode}`).toBeGreaterThan(0);
        for (const t of texts) expect(t, `${name} ${mode}`).not.toMatch(sentence);
        // the no-rival hover is not shown as text
        expect(texts.join(' '), `${name} ${mode}`).not.toContain(text.noneHover(RIVALS_VALUE.rangeMs));
        cleanup();
      }
    }
  });
});
