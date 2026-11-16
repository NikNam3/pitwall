// @vitest-environment jsdom
// The circle of doom as it renders (SP4.3d spec §6.5, V01; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html; C65,
// C68). The display only draws what the kit's circle (`kit/circle/`: `polarOf`, `placeCircleLabels`) and its own
// `layout.ts` return; every point below is checked against them, never against a number worked out here.
// Contract assumed of `CircleOfDoom.svelte` (props `WidgetProps<typeof widget>`, data `circle`, `cars`, `session`):
//  - one `svg[data-testid="circle"]` with `width` and `height` the layout's `size` (`circleLayout(size.px, size.mode,
//    DEFAULT_THEME.fontPx)`), holding `g[data-testid="field"]` with `transform="translate(<centre.x> <centre.y>)"` (a
//    comma between the numbers is fine); every point below is relative to the centre, as the kit returns it;
//  - the ring `circle[data-testid="ring"]`, `r` the layout's `radius`, `stroke` the `border` role, no fill;
//  - our car `circle[data-testid="own-dot"]` at the layout's `own.dot` (`cx`, `cy`), `fill` the `ownRole` colour, and
//    its code `text[data-testid="own-code"]` at `own.label` (`x`, `y`), bold, in the same colour (also compact);
//  - per car of `circle.cars` one `circle[data-car="<carId>"]` at `polarOf(behindMs, lapMs, radius)` with `data-kind`
//    `mate` (our car of `session.info` that is not the circle's) or `rival`: the teammate a ring (`fill="none"`, `stroke`
//    the `carRole('mate')` colour), a rival a dot (`fill` the `carRole('rival')` colour); each holds a `<title>` with the
//    car's code (the kit's `carCode` of its `cars.overview` identity), so a dot-only car shows its code on hover;
//  - full only (`codes`): per car the kit's `placeCircleLabels(cars, { lapMs, innerRadius, outerRadius, labelWidth,
//    ourCar, teammate })` decides: a label `text[data-label="<carId>"]` at its `label` point (`x`, `y`; centred:
//    `text-anchor="middle"`, `dominant-baseline="central"`), `data-ring` its ring, its code as text, `fill` its car's
//    colour; a `dot` car has no label;
//  - per ghost with a known `behindMs` one `g[data-ghost="<condition>"]` with `transform="translate(x y)"` at
//    `polarOf(behindMs, lapMs, radius)`, `data-on` `true` for `circle.current`'s ghost, else `false`, holding its letter
//    (G, V, S) and drawn in `ghostRole(on)` (its shapes' `stroke` and its letter's `fill`);
//  - the current ghost's rejoin place `text[data-testid="ghost-place"]` at `polarOf(behindMs, lapMs, ghostTextRadius)`
//    (`x`, `y`), bold, the kit's `formatPosition`; full only (`gaps`) `text[data-testid="ghost-gaps"]` below it,
//    `↑<aheadMs> ↓<behindCarMs>` through `formatSeconds(ms, 1)`, an unknown gap the kit's mark with its reason in a
//    `<title>` inside the gaps text;
//  - while `lapMs` or `cars` is unknown (our first lap): the ring and our car only, no car, no ghost, and one HTML element
//    `[data-testid="unknown"]` (the kit's `TextCell`) with the reason's mark in the faint role, its reason as `title`;
//  - numbers and short labels only, no sentence.
import { carCode } from '@pitwall/domain';
import type { CarId, Circle, CircleCar } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { placeCircleLabels, polarOf, type Point } from '../../kit/circle/index.ts';
import { cellBox } from '../../kit/size/size.ts';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { DEFAULT_THEME, role } from '../../theme/index.ts';
import CircleOfDoom from './CircleOfDoom.svelte';
import { carRole, ghostRole, ownRole } from './emphasis.ts';
import { cases, circle, FIELD, ghost, KUH, KUH_GHOSTS, KUH_TIMES, LIN, slotOf, fit } from './fixtures.ts';
import { circleLayout } from './layout.ts';
import { widget } from './widget.ts';

afterEach(cleanup);

type Data = (typeof cases)[keyof typeof cases];
type Mode = 'full' | 'compact';
/** The mockup's circles: 420 px full, 220 px compact. */
const MOCKUP_PX = { full: 420, compact: 220 } as const;
const FONT = DEFAULT_THEME.fontPx;

function mount(data: Data, mode: Mode = 'full', px: { width: number; height: number } = { width: MOCKUP_PX[mode], height: MOCKUP_PX[mode] }): HTMLElement {
  const s = widget.sizes[mode]!;
  return render(InPanel, {
    component: CircleOfDoom as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: { mode, cols: s.minCols, rows: s.minRows, px, dpr: 1 }, link: {} },
  }).container;
}

const layoutOf = (mode: Mode) => circleLayout({ width: MOCKUP_PX[mode], height: MOCKUP_PX[mode] }, mode, FONT);
const num = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr));
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** An element's own text, its `<title>` hover left out. */
function shownText(el: Element | null): string {
  if (el === null) return '';
  const copy = el.cloneNode(true) as Element;
  for (const t of copy.querySelectorAll('title')) t.remove();
  return textOf(copy);
}
/** The numbers of a `translate(x y)` or `translate(x, y)` transform. */
function translateOf(el: Element | null): Point {
  const m = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/u.exec(el?.getAttribute('transform') ?? '');
  if (m === null) throw new Error(`no translate on ${el?.outerHTML ?? 'nothing'}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}
function expectAt(actual: Point, expected: Point, what: string): void {
  expect(actual.x, `${what} x`).toBeCloseTo(expected.x, 3);
  expect(actual.y, `${what} y`).toBeCloseTo(expected.y, 3);
}
const centreOf = (c: HTMLElement): Point => translateOf(c.querySelector('g[data-testid="field"]'));
const dot = (c: HTMLElement, id: CarId): SVGCircleElement | null => c.querySelector(`circle[data-car="${id}"]`);
const label = (c: HTMLElement, id: CarId): SVGTextElement | null => c.querySelector(`text[data-label="${id}"]`);
const ghostEl = (c: HTMLElement, cond: string): SVGGElement | null => c.querySelector(`g[data-ghost="${cond}"]`);
const codeOf = (id: CarId): string => carCode(FIELD.find((f) => f.id === id)!.identity);
const knownValue = <T>(k: { known: boolean; value?: T }): T => k.value as T;

/** What the kit places for a case, with the layout's rings and widths. */
function kitLabels(circ: Circle, teammate: CarId, mode: Mode = 'full') {
  const l = layoutOf(mode);
  const cars = knownValue<CircleCar[]>(circ.cars).map((car) => ({ carId: car.carId, code: codeOf(car.carId), behindMs: car.behindMs }));
  return placeCircleLabels(cars, {
    lapMs: knownValue<number>(circ.lapMs), innerRadius: l.innerRadius, outerRadius: l.outerRadius, labelWidth: l.labelWidth,
    ourCar: circ.carId, teammate,
  });
}

/** Every car of the case is drawn where the kit puts it, labelled as the kit places it. */
function expectField(c: HTMLElement, data: Data, teammate: CarId): void {
  const l = layoutOf('full');
  const lap = knownValue<number>(data.circle.lapMs);
  const cars = knownValue<CircleCar[]>(data.circle.cars);
  expect(c.querySelectorAll('circle[data-car]')).toHaveLength(cars.length);
  for (const car of cars) {
    const d = dot(c, car.carId);
    expect(d, codeOf(car.carId)).not.toBeNull();
    expectAt({ x: num(d, 'cx'), y: num(d, 'cy') }, polarOf(car.behindMs, lap, l.radius), codeOf(car.carId));
    expect(textOf(d!.querySelector('title')), 'code on hover').toBe(codeOf(car.carId));
  }
  for (const p of kitLabels(data.circle, teammate)) {
    const t = label(c, p.carId);
    if (p.label === null) {
      expect(t, `${p.code} is a dot`).toBeNull();
      continue;
    }
    expect(t, p.code).not.toBeNull();
    expect(textOf(t)).toBe(p.code);
    expect(t!.getAttribute('data-ring'), p.code).toBe(p.ring);
    expectAt({ x: num(t, 'x'), y: num(t, 'y') }, p.label, `${p.code} label`);
    expect(t!.getAttribute('text-anchor')).toBe('middle');
    expect(t!.getAttribute('dominant-baseline')).toBe('central');
  }
}

/** The current ghost: its diamond where the kit puts it, its place and gaps. */
function expectCurrentGhost(c: HTMLElement, data: Data, place: string, gaps: string | null, mode: Mode = 'full'): void {
  const l = layoutOf(mode);
  const lap = knownValue<number>(data.circle.lapMs);
  const g = data.circle.ghosts.find((x) => x.condition === data.circle.current)!;
  const behind = knownValue<number>(g.behindMs);
  const el = ghostEl(c, g.condition);
  expect(el?.getAttribute('data-on')).toBe('true');
  expectAt(translateOf(el), polarOf(behind, lap, l.radius), `${g.condition} ghost`);
  const p = c.querySelector('text[data-testid="ghost-place"]');
  expect(textOf(p)).toBe(place);
  expectAt({ x: num(p, 'x'), y: num(p, 'y') }, polarOf(behind, lap, l.ghostTextRadius), 'rejoin place');
  const gapsEl = c.querySelector('text[data-testid="ghost-gaps"]');
  if (gaps === null) expect(gapsEl).toBeNull();
  else expect(shownText(gapsEl)).toBe(gaps);
}

describe('circle of doom, full: green running (the mockup\'s first figure, KUH at Spa L14)', () => {
  it('the ring and our car at its top: KUH white bold, its code below the dot', () => {
    const c = mount(cases.green);
    const l = layoutOf('full');
    const svg = c.querySelector('svg[data-testid="circle"]');
    expect([num(svg, 'width'), num(svg, 'height')]).toEqual([l.size, l.size]);
    expectAt(centreOf(c), l.centre, 'centre');
    const ring = c.querySelector('circle[data-testid="ring"]');
    expect(num(ring, 'r')).toBeCloseTo(l.radius, 3);
    expect(ring?.getAttribute('stroke')).toBe(role('border'));
    const own = c.querySelector('circle[data-testid="own-dot"]');
    expectAt({ x: num(own, 'cx'), y: num(own, 'cy') }, l.own.dot, 'our dot');
    expect(own?.getAttribute('fill')).toBe(role(ownRole()));
    const code = c.querySelector('text[data-testid="own-code"]');
    expect(textOf(code)).toBe('KUH');
    expectAt({ x: num(code, 'x'), y: num(code, 'y') }, l.own.label, 'our code');
    expect(code?.getAttribute('fill')).toBe(role(ownRole()));
    expect(code?.getAttribute('font-weight')).toMatch(/^(?:bold|[6-9]00)$/u);
    // our car is not one of the field's dots
    expect(dot(c, KUH)).toBeNull();
  });

  it('every car at its time behind us, clockwise; LIN the white ring, the rest grey dots', () => {
    const c = mount(cases.green);
    expectField(c, cases.green, LIN);
    const lin = dot(c, LIN)!;
    expect([lin.getAttribute('data-kind'), lin.getAttribute('fill'), lin.getAttribute('stroke')]).toEqual(['mate', 'none', role(carRole('mate'))]);
    const rus = dot(c, slotOf('RUS'))!;
    expect([rus.getAttribute('data-kind'), rus.getAttribute('fill')]).toEqual(['rival', role(carRole('rival'))]);
    // RUS, 1.4 s behind, just right of the top; PIA, 3.1 s ahead, just left of it; MAG, past half a lap, low on the left
    expect(num(rus, 'cx')).toBeGreaterThan(0);
    expect(num(dot(c, slotOf('PIA')), 'cx')).toBeLessThan(0);
    expect(num(dot(c, slotOf('MAG')), 'cx')).toBeLessThan(0);
    expect(num(dot(c, slotOf('MAG')), 'cy')).toBeGreaterThan(0);
  });

  it('labels as the kit places them: RUS, 1.4 s behind, on the outer ring (our code\'s slot is taken), the others inner', () => {
    const c = mount(cases.green);
    expect(label(c, slotOf('RUS'))?.getAttribute('data-ring')).toBe('outer');
    for (const code of ['SAI', 'LIN', 'GAS', 'OCO', 'TSU', 'PIA'] as const) expect(label(c, slotOf(code))?.getAttribute('data-ring'), code).toBe('inner');
    expect(label(c, LIN)?.getAttribute('fill')).toBe(role(carRole('mate')));
    expect(label(c, slotOf('SAI'))?.getAttribute('fill')).toBe(role(carRole('rival')));
  });

  it('the ghosts G V S where the topic puts them; G white with P13 ↑1.4 ↓1.2, V and S faint', () => {
    const c = mount(cases.green);
    expectCurrentGhost(c, cases.green, 'P13', '↑1.4 ↓1.2');
    const l = layoutOf('full');
    for (const g of KUH_GHOSTS) {
      const el = ghostEl(c, g.condition)!;
      expectAt(translateOf(el), polarOf(knownValue<number>(g.behindMs), 106_000, l.radius), g.condition);
      const on = g.condition === 'green';
      expect(el.getAttribute('data-on'), g.condition).toBe(String(on));
      const letter = [...el.querySelectorAll('text')].map((t) => textOf(t)).join('');
      expect(letter).toBe({ green: 'G', vsc: 'V', sc: 'S' }[g.condition]);
      for (const t of el.querySelectorAll('text')) expect(t.getAttribute('fill'), g.condition).toBe(role(ghostRole(on)));
      for (const s of el.querySelectorAll('rect, path, polygon')) expect(s.getAttribute('stroke'), g.condition).toBe(role(ghostRole(on)));
    }
    // one place and one gaps line: the current ghost's only
    expect(c.querySelectorAll('[data-testid="ghost-place"]')).toHaveLength(1);
    expect(c.querySelectorAll('[data-testid="ghost-gaps"]')).toHaveLength(1);
    expect(c.querySelector('text[data-testid="ghost-place"]')?.getAttribute('font-weight')).toMatch(/^(?:bold|[6-9]00)$/u);
  });
});

describe('circle of doom, full: after a spin (6 s later)', () => {
  it('OCO 4.6 s further back; G now P12 ↑8.1 ↓3.2; the labels re-placed by the kit', () => {
    const c = mount(cases.spun);
    expectField(c, cases.spun, LIN);
    expectAt(
      { x: num(dot(c, slotOf('OCO')), 'cx'), y: num(dot(c, slotOf('OCO')), 'cy') },
      polarOf(25_500, 106_000, layoutOf('full').radius),
      'OCO',
    );
    expectCurrentGhost(c, cases.spun, 'P12', '↑8.1 ↓3.2');
    // OCO now sits between TSU and ALB: three cars too tight to fan, TSU (closest to us) keeps its code
    expect(label(c, slotOf('TSU'))?.getAttribute('data-ring')).toBe('inner');
    expect(label(c, slotOf('OCO'))).toBeNull();
    expect(label(c, slotOf('ALB'))).toBeNull();
  });
});

describe('circle of doom, full: SC deployed', () => {
  it('S white with P11 ↑0.3 ↓4.4; G and V faint', () => {
    const c = mount(cases.sc);
    expectCurrentGhost(c, cases.sc, 'P11', '↑0.3 ↓4.4');
    expect(ghostEl(c, 'green')?.getAttribute('data-on')).toBe('false');
    expect(ghostEl(c, 'vsc')?.getAttribute('data-on')).toBe('false');
    expectField(c, cases.sc, LIN);
  });
});

describe('circle of doom, full: LIN\'s circle and close cars (the label rule)', () => {
  it('LIN at the top; KUH the white ring; KUH and RUS, 1.4 s apart, fanned on two rings', () => {
    const c = mount(cases.lin);
    expect(textOf(c.querySelector('text[data-testid="own-code"]'))).toBe('LIN');
    expect(dot(c, LIN)).toBeNull();
    expect(dot(c, KUH)?.getAttribute('data-kind')).toBe('mate');
    expectField(c, cases.lin, KUH);
    expect([label(c, KUH)?.getAttribute('data-ring'), label(c, slotOf('RUS'))?.getAttribute('data-ring')]).toEqual(['inner', 'outer']);
    expectCurrentGhost(c, cases.lin, 'P16', '↑0.8 ↓4.2');
  });

  it('KUH, RUS and PIA within 1 s render as the kit places them: KUH (the teammate) keeps its code, RUS and PIA dots with their codes on hover', () => {
    const c = mount(cases.tight);
    expectField(c, cases.tight, KUH);
    expect(label(c, KUH)?.getAttribute('data-ring')).toBe('inner');
    for (const code of ['RUS', 'PIA'] as const) {
      expect(label(c, slotOf(code)), code).toBeNull();
      expect(textOf(dot(c, slotOf(code))!.querySelector('title')), code).toBe(code);
    }
  });
});

describe('circle of doom, compact (220 px)', () => {
  it('no codes: every car a dot where the kit puts it, our code kept; the current ghost with its place only', () => {
    const c = mount(cases.green, 'compact');
    const l = layoutOf('compact');
    expect(num(c.querySelector('circle[data-testid="ring"]'), 'r')).toBeCloseTo(l.radius, 3);
    expect(c.querySelectorAll('text[data-label]')).toHaveLength(0);
    for (const car of knownValue<CircleCar[]>(cases.green.circle.cars)) {
      expectAt({ x: num(dot(c, car.carId), 'cx'), y: num(dot(c, car.carId), 'cy') }, polarOf(car.behindMs, 106_000, l.radius), codeOf(car.carId));
    }
    expect(textOf(c.querySelector('text[data-testid="own-code"]'))).toBe('KUH');
    expectCurrentGhost(c, cases.green, 'P13', null, 'compact');
    expect(c.querySelectorAll('g[data-ghost]')).toHaveLength(3);
  });
});

describe('circle of doom: the first lap and unknown values', () => {
  it('our first lap: the ring and our car only, the kit\'s pending mark with its reason on hover', () => {
    for (const mode of ['full', 'compact'] as const) {
      const c = mount(cases.firstLap, mode);
      expect(c.querySelector('circle[data-testid="ring"]'), mode).not.toBeNull();
      expect(textOf(c.querySelector('text[data-testid="own-code"]')), mode).toBe('KUH');
      expect(c.querySelectorAll('circle[data-car], text[data-label], g[data-ghost], [data-testid="ghost-place"], [data-testid="ghost-gaps"]'), mode).toHaveLength(0);
      const u = c.querySelector<HTMLElement>('[data-testid="unknown"]');
      expect(u, mode).not.toBeNull();
      const titled = u!.closest('[title]') ?? u!.querySelector('[title]');
      expect(titled?.getAttribute('title'), mode).toBe(unknownReason.insufficientData);
      expect(textOf(u), mode).toBe(unknownMark.insufficientData);
      const faint = [u!, ...u!.querySelectorAll<HTMLElement>('*')].some((e) => e.style.color === role('textFaint'));
      expect(faint, mode).toBe(true);
      cleanup();
    }
  });

  it('a known lap with unknown places: the same mark; a ghost with an unknown place behind us is not drawn', () => {
    const noCars: Data = { ...cases.green, circle: { ...cases.green.circle, cars: { known: false, reason: 'notReceived' } } };
    const c = mount(noCars);
    expect(c.querySelectorAll('circle[data-car], g[data-ghost]')).toHaveLength(0);
    expect(textOf(c.querySelector('[data-testid="unknown"]'))).toBe(unknownMark.notReceived);
    cleanup();
    const noGreen: Data = {
      ...cases.green,
      circle: { ...cases.green.circle, ghosts: [{ ...KUH_GHOSTS[0]!, behindMs: { known: false, reason: 'insufficientData' } }, KUH_GHOSTS[1]!, KUH_GHOSTS[2]!] },
    };
    const d = mount(noGreen);
    expect(ghostEl(d, 'green')).toBeNull();
    expect(ghostEl(d, 'vsc')).not.toBeNull();
    expect(d.querySelector('[data-testid="ghost-place"]')).toBeNull();
  });

  it('an unknown gap: the kit\'s mark after its arrow, its reason on hover', () => {
    const last = { ...circle(KUH, KUH_TIMES, KUH_GHOSTS), ghosts: [{ ...ghost('green', [22_300, 13, 1_400, 0]), behindCarMs: { known: false as const, reason: 'notApplicable' as const } }, KUH_GHOSTS[1]!, KUH_GHOSTS[2]!] };
    const c = mount({ ...cases.green, circle: last });
    const gaps = c.querySelector('text[data-testid="ghost-gaps"]');
    expect(shownText(gaps)).toBe(`↑1.4 ↓${unknownMark.notApplicable}`);
    expect([...gaps!.querySelectorAll('title')].map((t) => textOf(t))).toContain(unknownReason.notApplicable);
  });
});

describe('circle of doom: numbers and short labels only', () => {
  it('no visible text but codes, ghost letters, places, gaps and marks', () => {
    const marks = new Set<string>(Object.values(unknownMark));
    const token = /^(?:[A-Z]{3}|[GVS]|P\d+|[↑↓]\d+\.\d)$/u;
    for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
      for (const mode of ['full', 'compact'] as const) {
        const c = mount(cases[name], mode);
        const svg = c.querySelector('svg[data-testid="circle"]');
        const visible = [shownText(svg), shownText(c.querySelector('[data-testid="unknown"]'))].join(' ');
        for (const t of visible.split(/\s+/u).filter((s) => s !== '')) {
          if (!marks.has(t)) expect(t, `${name} ${mode}`).toMatch(token);
        }
        cleanup();
      }
    }
  });

  it('every case fits every fit size: the circle inside the panel', () => {
    const box = cellBox(FONT, DEFAULT_THEME.density.lineHeight);
    for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
      for (const size of fit) {
        const px = { width: size.cols * box.width, height: size.rows * box.height };
        const c = mount(cases[name], size.mode as Mode, px);
        const svg = c.querySelector('svg[data-testid="circle"]');
        const at = `${name} at ${size.mode} ${size.cols}x${size.rows}`;
        expect(num(svg, 'width'), at).toBeLessThanOrEqual(px.width);
        expect(num(svg, 'height'), at).toBeLessThanOrEqual(px.height);
        cleanup();
      }
    }
  });
});
