// @vitest-environment jsdom
// The kit's track canvas (spec 7.1): measures its box, lays the scene out with `layoutTrack` and draws it through the
// kit's canvas in theme roles only (C68); a car's colour is `carColour`'s result, resolved as the chart resolves it.
// The 2D context is a recording fake (as kit/canvas.test.ts): every method call is recorded in `ops` with the fill and
// stroke style at call time; `measureText` measures 8 px per character. The ResizeObserver reports a 400 x 300 px box
// when observed (as the gallery tests do).
// Contract the tests assume of TrackCanvas.svelte:
//  - the outline is one stroked path (beginPath, moveTo/lineTo through every outline point, stroke) in `lineRole`;
//  - a stretch is a stroked path in its role through the outline points in its fraction range (point i of n at i / n),
//    possibly with its two end points added;
//  - a solid dot is a filled path holding an `arc` of its `radiusPx`, filled in its resolved colour;
//  - every colour it draws with is a resolved theme role or a team colour of a dot, never a literal of its own.
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { carId } from '@pitwall/domain';
import TrackCanvas from '../../src/kit/track/TrackCanvas.svelte';
import type { TrackScene } from '../../src/kit/track/types.ts';
import { carColour } from '../../src/theme/index.ts';
import type { Role } from '../../src/theme/index.ts';
import { ellipse } from './track-fixtures.ts';

type Op = { op: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown };
let ops: Op[] = [];

/** A 2D context that records every method call; properties are plain values. */
function fakeContext(): unknown {
  const state: Record<string | symbol, unknown> = {
    fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif', lineWidth: 1, globalAlpha: 1,
    textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter',
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        ops.push({ op: String(key), args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle });
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

/** A distinct value for every role, published on the document root. */
const ROLES: Record<Role, string> = {
  text: '#a00001', textDim: '#a00002', textFaint: '#a00003', ownCar: '#a00004',
  bg: '#a00005', bgPanel: '#a00006', bgBand: '#a00007', bgRowBand: '#a00008',
  border: '#a00009', grid: '#a0000a', dropTarget: '#a0000b', focus: '#a0000c',
  critical: '#a0000d', warning: '#a0000e', best: '#a0000f', personalBest: '#a00010',
  flagYellow: '#a00011', flagGreen: '#a00012', flagRed: '#a00013', flagBlue: '#a00014',
  compoundSoft: '#a00015', compoundMedium: '#a00016', compoundHard: '#a00017',
  series1: '#a00018', series2: '#a00019', series3: '#a0001a', series4: '#a0001b', series5: '#a0001c', series6: '#a0001d',
};
const TOKENS: Record<string, string> = { '--pw-font-px': '13px', '--pw-line': '1.4', '--pw-font': 'TestMono' };

const field = [
  { id: carId(0), teamId: 8, raceNumber: 4 },
  { id: carId(1), teamId: 0, raceNumber: 63 },
];
const own = new Set([carId(0)]);
const rival = carColour(field[1]!, field, own);
const ours = carColour(field[0]!, field, own);
const MERCEDES = '#00a7af';

const N = 100;
const outline = ellipse(N);
const scene: TrackScene = {
  outline,
  lineRole: 'textFaint',
  stretches: [{ start: 0.2, end: 0.4, role: 'flagYellow' }],
  labels: [{ text: 'T1', at: outline[0]! }],
  dots: [
    { id: 'rival', at: outline[60]!, colour: rival, radiusPx: 4, hollow: false },
    { id: 'ours', at: outline[80]!, colour: ours, radiusPx: 6, hollow: false },
  ],
  markers: [],
};

beforeEach(() => {
  ops = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 400, height: 300 } }]);
      }
      disconnect() {}
    },
  );
  for (const [r, v] of Object.entries(ROLES)) document.documentElement.style.setProperty(`--pw-${r}`, v);
  for (const [k, v] of Object.entries(TOKENS)) document.documentElement.style.setProperty(k, v);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const r of Object.keys(ROLES)) document.documentElement.style.removeProperty(`--pw-${r}`);
  for (const k of Object.keys(TOKENS)) document.documentElement.style.removeProperty(k);
});

/** Each painted path: the ops since its `beginPath` and the paint op (fill or stroke) that ends it. */
function paintedPaths(): Array<{ paint: Op; path: Op[] }> {
  const out: Array<{ paint: Op; path: Op[] }> = [];
  let path: Op[] = [];
  for (const o of ops) {
    if (o.op === 'beginPath') path = [];
    else if (o.op === 'fill' || o.op === 'stroke') out.push({ paint: o, path });
    else path.push(o);
  }
  return out;
}
const vertices = (path: Op[]) => path.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');

async function drawn(): Promise<void> {
  render(TrackCanvas, { scene });
  await tick();
}

describe('TrackCanvas', () => {
  it('draws the outline in the line role', async () => {
    await drawn();
    const outlines = paintedPaths().filter((p) => p.paint.op === 'stroke' && p.paint.strokeStyle === ROLES.textFaint);
    expect(outlines.some((p) => vertices(p.path).length >= N)).toBe(true);
  });

  it('draws a stretch in its role over its fraction range', async () => {
    await drawn();
    const stretches = paintedPaths().filter((p) => p.paint.op === 'stroke' && p.paint.strokeStyle === ROLES.flagYellow);
    expect(stretches.length).toBe(1);
    // 0.2 to 0.4 of 100 points: points 20 to 40, give or take its two end points
    const n = vertices(stretches[0]!.path).length;
    expect(n).toBeGreaterThanOrEqual(19);
    expect(n).toBeLessThanOrEqual(23);
  });

  it('draws a dot in its resolved car colour', async () => {
    await drawn();
    const fills = paintedPaths().filter((p) => p.paint.op === 'fill');
    const arcOf = (colour: string) => fills.filter((p) => p.paint.fillStyle === colour).flatMap((p) => p.path.filter((o) => o.op === 'arc').map((o) => o.args[2]));
    // a team colour as given; the own car's `var(--pw-ownCar)` resolved where the canvas is drawn
    expect(arcOf(MERCEDES)).toContain(4);
    expect(arcOf(ROLES.ownCar)).toContain(6);
  });

  it('draws in theme roles and team colours only', async () => {
    await drawn();
    const allowed = new Set([...Object.values(ROLES), MERCEDES]);
    const painting = ops.filter((o) => ['fill', 'fillRect', 'fillText'].includes(o.op) || ['stroke', 'strokeRect', 'strokeText'].includes(o.op));
    expect(painting.length).toBeGreaterThan(0);
    const colours = painting.map((o) => (o.op.startsWith('stroke') ? o.strokeStyle : o.fillStyle));
    expect(colours.filter((c) => !allowed.has(c as string))).toEqual([]);
  });
});
