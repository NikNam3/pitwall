// jsdom has no canvas: `getContext('2d')` returns null (with a "not implemented" console error) and `Path2D` does not
// exist, so uPlot's first draw throws on a null context. A browser always has both. This gives every jsdom UI test an
// inert 2D context, the answer a browser gives without the pixels: drawing calls draw nothing, `measureText` measures
// in the theme's character cells (the UI's font is monospace). A test that checks what is drawn replaces `getContext`
// with its own recording fake (kit/canvas.test.ts); one that checks what uPlot is given mocks uPlot (kit/chart.test.ts).
import { cellBox } from '../src/kit/size/size.ts';
import { DEFAULT_THEME } from '../src/theme/index.ts';

/** The drawing calls the kit's canvas, the chart's hooks and uPlot make: each draws nothing. */
const DRAWING = [
  'arc', 'arcTo', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'fill', 'fillRect', 'fillText',
  'lineTo', 'moveTo', 'quadraticCurveTo', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform',
  'stroke', 'strokeRect', 'strokeText', 'translate',
] as const;

const FONT_PX = /(\d+(?:\.\d+)?)px/;

/** An inert 2D context of `canvas` with the default state of a fresh browser context. */
function inertContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = {
    canvas,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText(text: string) {
      const px = Number(FONT_PX.exec(ctx.font)?.[1] ?? DEFAULT_THEME.fontPx);
      return { width: text.length * cellBox(px, DEFAULT_THEME.density.lineHeight).width };
    },
  } as Record<string, unknown> & { font: string };
  for (const name of DRAWING) ctx[name] = () => {};
  return ctx as unknown as CanvasRenderingContext2D;
}

/** A path that records nothing: the calls uPlot makes on a `Path2D`. */
class InertPath2D {
  addPath(): void {}
  arc(): void {}
  arcTo(): void {}
  bezierCurveTo(): void {}
  closePath(): void {}
  ellipse(): void {}
  lineTo(): void {}
  moveTo(): void {}
  quadraticCurveTo(): void {}
  rect(): void {}
}

/** Installs the inert context and `Path2D` in a jsdom environment; a node environment has no canvas to answer for. */
export function installCanvas2d(): void {
  if (typeof HTMLCanvasElement === 'undefined') return;
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  // A browser returns the same context on every call, and null for a kind it does not offer.
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    let ctx = contexts.get(this);
    if (ctx === undefined) contexts.set(this, (ctx = inertContext(this)));
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
  if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = InertPath2D as unknown as typeof Path2D;
}
