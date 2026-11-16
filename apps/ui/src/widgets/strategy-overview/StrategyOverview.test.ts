// @vitest-environment jsdom
// Field plans as it renders (SP4.3d spec §6.4, V06; mockup docs/design/2026-11-16-sp4.3d/strategy-overview.html, full
// 71×10, compact 28×10; C65, C68). Contract assumed of `StrategyOverview.svelte` (props `WidgetProps<typeof widget>`, data
// `overview`, `cars`, `session`; the lap now is the link car's `timing.lap` in `cars`, the flag `session.totalLaps`):
//  - one header line, then per topic row one line `[data-car="<carId>"]` in topic order with `data-kind` (`own`, `mate`,
//    `rival`, rows.ts) and its emphasis (emphasis.ts `rowEmphasis`) as `data-role`, `data-bold` and `data-bar`;
//  - full: per line the cells `[data-testid="code|pos|gap|tyre|owe|next"]` (rows.ts; `owe` holds `²` or nothing; `next`
//    with its hover `nextHover` as a `title`), then the lane `svg[data-testid="lane"]` (lane.ts `laneOf`): per block one
//    `[data-block]` element with `data-from`, `data-to`, `data-style` and its letter as text, per shade one
//    `[data-shade]` with `data-lap` and its `opacity` attribute, per mark one `[data-mark]` with `data-lap`, and the now
//    line `[data-testid="now"]`; the header line holds POS, GAP, TYRE, NEXT and over the lane the laps 1, 10, 20, 30, 40
//    in `[data-testid="axis"]`;
//  - compact: per line `code`, `gap`, `tyre`, `window`, `next`; no lane; the header line GAP, TYRE, WINDOW, NEXT;
//  - an unknown part shows the kit's mark, its reason on hover; numbers and short labels only, no sentence.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { cases, KUH, LIN, NOR } from './fixtures.ts';
import StrategyOverview from './StrategyOverview.svelte';

afterEach(cleanup);

const SIZES = { compact: { cols: 28, rows: 10 }, full: { cols: 71, rows: 10 } } as const;
type Data = (typeof cases)[keyof typeof cases];

function mount(data: Data, mode: keyof typeof SIZES = 'full'): HTMLElement {
  const size = SIZES[mode];
  return render(InPanel, {
    component: StrategyOverview as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 19.6 }, dpr: 1 }, link: {} },
  }).container;
}

const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cell = (line: Element, id: string): string => textOf(line.querySelector(`[data-testid="${id}"]`));
const lines = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-car]')];
const line = (c: HTMLElement, id: number): HTMLElement => c.querySelector<HTMLElement>(`[data-car="${id}"]`)!;
/** Every hover in an element: its own title, its titled ancestor's and its descendants'. */
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
/** Every visible text node of the widget, trimmed, without empty ones (SVG `<title>` is a hover, not visible). */
function visibleTexts(c: HTMLElement): string[] {
  const walker = c.ownerDocument.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim();
    if (t !== '' && n.parentElement?.closest('title, option, script, style, output') === null) out.push(t);
  }
  return out;
}
const blocks = (l: Element) => [...l.querySelectorAll('[data-block]')].map((b) => [Number(b.getAttribute('data-from')), Number(b.getAttribute('data-to')), b.getAttribute('data-style'), textOf(b)]);

describe('Field plans, full (the mockup\'s figure, Spa L14/44 around KUH)', () => {
  it('one line per car in race order: KUH with the bar, LIN white bold, the rivals plain', () => {
    const c = mount(cases.field);
    expect(lines(c).map((l) => cell(l, 'code'))).toEqual(['ALO', 'NOR', 'PIA', 'KUH', 'RUS', 'SAI', 'LIN', 'GAS', 'OCO']);
    const kuh = line(c, KUH);
    expect([kuh.dataset['kind'], kuh.dataset['role'], kuh.dataset['bold'], kuh.dataset['bar']]).toEqual(['own', 'ownCar', 'true', 'true']);
    const lin = line(c, LIN);
    expect([lin.dataset['kind'], lin.dataset['role'], lin.dataset['bold'], lin.dataset['bar']]).toEqual(['mate', 'ownCar', 'true', 'false']);
    expect(line(c, NOR).dataset['kind']).toBe('rival');
  });

  it('NOR\'s cells: P6, −9.8, M 14, ², H80 with its odds and window on hover', () => {
    const nor = line(mount(cases.field), NOR);
    expect(['pos', 'gap', 'tyre', 'owe', 'next'].map((id) => cell(nor, id))).toEqual(['P6', '−9.8', 'M 14', '²', 'H80']);
    const hover = hovers(nor.querySelector('[data-testid="next"]')!).join(' ');
    for (const t of ['H 80%', 'S 20%', 'L18']) expect(hover).toContain(t);
  });

  it('NOR\'s lane: mediums solid to now, faint to the window, the window L16–20 shaded darkest at L18, hards faint after it', () => {
    const nor = line(mount(cases.field), NOR);
    const lane = nor.querySelector('svg[data-testid="lane"]')!;
    expect(blocks(lane)).toEqual([[1, 14, 'solid', 'M'], [15, 15, 'faint', ''], [21, 44, 'faint', 'H']]);
    const shades = [...lane.querySelectorAll('[data-shade]')].map((s) => [Number(s.getAttribute('data-lap')), Number(s.getAttribute('opacity'))]);
    expect(shades.map(([lap]) => lap)).toEqual([16, 17, 18, 19, 20]);
    const op = shades.map(([, o]) => o!);
    expect(Math.max(...op)).toBe(op[2]);
    expect(op[0]).toBeLessThan(op[1]!);
    expect(op[4]).toBeLessThan(op[3]!);
    expect(lane.querySelector('[data-testid="now"]')).not.toBeNull();
  });

  it('KUH\'s lane: plan A outlined (L15–22, H to the flag), plan B\'s stops L18 and L33 as marks', () => {
    const lane = line(mount(cases.field), KUH).querySelector('svg[data-testid="lane"]')!;
    expect(blocks(lane)).toEqual([[1, 14, 'solid', 'M'], [15, 22, 'outline', ''], [23, 44, 'outline', 'H']]);
    expect([...lane.querySelectorAll('[data-mark]')].map((m) => Number(m.getAttribute('data-lap')))).toEqual([18, 33]);
    // a rival's lane has no marks
    expect(line(mount(cases.field), NOR).querySelectorAll('[data-mark]')).toHaveLength(0);
  });

  it('the header line: POS, GAP, TYRE, NEXT and the lap axis 1, 10, 20, 30, 40', () => {
    const c = mount(cases.field);
    const all = visibleTexts(c);
    for (const h of ['POS', 'GAP', 'TYRE', 'NEXT']) expect(all).toContain(h);
    const axis = textOf(c.querySelector('[data-testid="axis"]')).split(' ');
    expect(axis).toEqual(['1', '10', '20', '30', '40']);
  });

  it('numbers and short labels only: no visible text longer than six characters', () => {
    for (const data of Object.values(cases)) {
      for (const mode of ['full', 'compact'] as const) {
        for (const t of visibleTexts(mount(data, mode))) expect(t.length, t).toBeLessThanOrEqual(6);
        cleanup();
      }
    }
  });
});

describe('Field plans, compact (no lane; the window as laps, our rows plan A\'s next stop)', () => {
  it('per line code, gap, tyre, window, next as the mockup draws them', () => {
    const c = mount(cases.field, 'compact');
    expect(c.querySelector('svg[data-testid="lane"]')).toBeNull();
    expect(lines(c).map((l) => ['code', 'gap', 'tyre', 'window', 'next'].map((id) => cell(l, id)))).toEqual([
      ['ALO', '−15.2', 'H 2', '', ''],
      ['NOR', '−9.8', 'M 14', 'L16–20', 'H80'],
      ['PIA', '−3.1', 'M 14', 'L18–23', 'H70'],
      ['KUH', '', 'M 14', 'A L22', ''],
      ['RUS', '+1.4', 'M 14', 'L19–24', 'H90'],
      ['SAI', '+6.0', 'H 14', 'L24–30', 'M60'],
      ['LIN', '+9.5', 'M 14', 'A L21', ''],
      ['GAS', '+14.2', 'S 14', 'L13–17', 'H85'],
      ['OCO', '+20.9', 'M 14', 'L20–26', 'H75'],
    ]);
    const all = visibleTexts(c);
    for (const h of ['GAP', 'TYRE', 'WINDOW', 'NEXT']) expect(all).toContain(h);
    expect(line(c, KUH).dataset['bar']).toBe('true');
  });
});

describe('Field plans, the other states', () => {
  it('the pit loss unknown: our two rows only; LIN without plan B has no marks; its unknown gap the kit\'s mark', () => {
    const c = mount(cases.oursOnly);
    expect(lines(c).map((l) => l.dataset['car'])).toEqual([String(KUH), String(LIN)]);
    const lin = line(c, LIN);
    expect(lin.querySelectorAll('[data-mark]')).toHaveLength(0);
    expect(cell(lin, 'gap')).toBe(unknownMark.insufficientData);
    expect(hovers(lin.querySelector('[data-testid="gap"]')!)).toContain(unknownReason.insufficientData);
  });

  it('L02, too few laps: a rival\'s NEXT the kit\'s mark with its reason, no shades; KUH without a plan: nothing outlined', () => {
    const c = mount(cases.early);
    const nor = line(c, NOR);
    expect(cell(nor, 'next')).toBe(unknownMark.insufficientData);
    expect(hovers(nor.querySelector('[data-testid="next"]')!)).toContain(unknownReason.insufficientData);
    expect(nor.querySelectorAll('[data-shade]')).toHaveLength(0);
    const kuh = line(c, KUH).querySelector('svg[data-testid="lane"]')!;
    expect(blocks(kuh)).toEqual([[1, 2, 'solid', 'M']]);
  });

  it('LIN\'s panel: LIN has the bar, KUH is white bold', () => {
    const c = mount(cases.forLin);
    expect(line(c, LIN).dataset['bar']).toBe('true');
    expect([line(c, KUH).dataset['kind'], line(c, KUH).dataset['bar']]).toEqual(['mate', 'false']);
  });
});
