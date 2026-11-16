// The circle-of-doom's layout (SP4.3d spec §6.5; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html, gen.mjs
// `circleSvg`, `labelPlaces`): the sizes the drawing is made of, from the panel's pixels. Where a car or label sits on
// the circle is the kit's (`kit/circle/`: `polarOf`, `placeCircleLabels`); the layout only gives the radii and widths
// the kit is called with (C65). Contract assumed of `layout.ts`:
//  - `circleLayout(px: { width: number; height: number }, mode: string, fontPx: number): CircleLayout`, with
//    `size`: the circle's square, `min(width, height)`; `centre`: `{ x: size / 2, y: size / 2 }` (the field is drawn
//    relative to it); `radius`: the ring, `0.36 · size`; `innerRadius` and `outerRadius`: the label rings, `radius + 22`
//    and `radius + 40`; `codeFontPx`: the codes' font, `fontPx − 2` full, `fontPx − 4` compact; `labelWidth`: three
//    monospace characters and a little air, `3 · codeFontPx · 0.62 + 4`; `ghostTextRadius`: where the current ghost's
//    rejoin place is drawn, `radius − 46` full, `radius − 30` compact; `codes`: car codes drawn (full only); `gaps`: the
//    current ghost's ↑ ↓ gaps drawn (full only); `own`: our car's dot at the top of the ring and its code's point
//    22 px below it (`{ dot: { x: 0, y: −radius }, label: { x: 0, y: −radius + 22 } }`, the kit's `polarOf` at 0).
import { describe, expect, it } from 'vitest';
import { polarOf } from '../../kit/circle/index.ts';
import { circleLayout } from './layout.ts';

const FONT = 14;

describe('circleLayout: the mockup\'s full circle, 420 px', () => {
  const l = circleLayout({ width: 420, height: 420 }, 'full', FONT);

  it('a 420 px square around its centre, the ring at 0.36 of it', () => {
    expect(l.size).toBe(420);
    expect(l.centre).toEqual({ x: 210, y: 210 });
    expect(l.radius).toBeCloseTo(151.2, 6);
  });

  it('labels on two rings, 22 and 40 px outside the ring, a label three characters of the 12 px code font wide', () => {
    expect(l.innerRadius).toBeCloseTo(173.2, 6);
    expect(l.outerRadius).toBeCloseTo(191.2, 6);
    expect(l.codeFontPx).toBe(12);
    expect(l.labelWidth).toBeCloseTo(3 * 12 * 0.62 + 4, 6);
  });

  it('the current ghost\'s place 46 px inside the ring; codes and gaps drawn', () => {
    expect(l.ghostTextRadius).toBeCloseTo(105.2, 6);
    expect([l.codes, l.gaps]).toEqual([true, true]);
  });

  it('our car at the top of the ring, its code 22 px below', () => {
    const top = polarOf(0, 1, l.radius);
    expect(l.own.dot.x).toBeCloseTo(top.x, 6);
    expect(l.own.dot.y).toBeCloseTo(-151.2, 6);
    expect(l.own.label.x).toBeCloseTo(0, 6);
    expect(l.own.label.y).toBeCloseTo(-129.2, 6);
  });
});

describe('circleLayout: compact, 220 px', () => {
  const l = circleLayout({ width: 220, height: 220 }, 'compact', FONT);

  it('the ring at 0.36 of 220, the place 30 px inside it, no codes and no gaps', () => {
    expect(l.size).toBe(220);
    expect(l.radius).toBeCloseTo(79.2, 6);
    expect(l.ghostTextRadius).toBeCloseTo(49.2, 6);
    expect(l.codeFontPx).toBe(10);
    expect([l.codes, l.gaps]).toEqual([false, false]);
  });
});

describe('circleLayout: a panel that is not square', () => {
  it('the circle takes the smaller side', () => {
    expect(circleLayout({ width: 560, height: 431 }, 'full', FONT).size).toBe(431);
    expect(circleLayout({ width: 300, height: 500 }, 'full', FONT).centre).toEqual({ x: 150, y: 150 });
  });
});
