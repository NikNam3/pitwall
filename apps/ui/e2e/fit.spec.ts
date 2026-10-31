// Fit (spec 9.3): in every gallery cell nothing in the widget body overflows and no text is clipped, the text a chart
// draws on its canvas included (review 7, R7-9: the gap chart's compact y label was cut to "behind referen").
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGallery } from './harness.ts';
import type { GalleryHandle } from './harness-contract.ts';

/** The tolerance of the browser's rounding; the gallery gives every box this much room (gallery/layout.ts SUBPIXEL_PX). */
const SUBPIXEL_PX = 0.5;

type Violation = { id: string; problem: string };

/** A text drawn on a canvas, as the box its glyphs cover (canvas px, after the context's transform). */
type DrawnText = { text: string; left: number; top: number; right: number; bottom: number };
/** The texts of each canvas' latest draw (a clear of the whole canvas, or a new canvas size, starts a new one). */
type CanvasTexts = Map<HTMLCanvasElement, { width: number; height: number; texts: DrawnText[] }>;

/**
 * Runs in the gallery page before its scripts: records every `fillText` and `strokeText` of a 2D canvas with the box of
 * its glyphs (`measureText`'s actual bounding box from the text's anchor, through the current transform, so a rotated
 * axis label counts too), per canvas, in `window.__pwCanvasTexts`.
 */
function recordCanvasTexts(): void {
  type Drawn = { text: string; left: number; top: number; right: number; bottom: number };
  const drawn = new Map<HTMLCanvasElement, { width: number; height: number; texts: Drawn[] }>();
  (window as unknown as { __pwCanvasTexts: typeof drawn }).__pwCanvasTexts = drawn;
  const proto = CanvasRenderingContext2D.prototype;
  const draw = (ctx: CanvasRenderingContext2D): { width: number; height: number; texts: Drawn[] } => {
    const { canvas } = ctx;
    let entry = drawn.get(canvas);
    if (entry === undefined || entry.width !== canvas.width || entry.height !== canvas.height) {
      entry = { width: canvas.width, height: canvas.height, texts: [] };
      drawn.set(canvas, entry);
    }
    return entry;
  };
  const record = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void => {
    if (text.trim() === '') return;
    const m = ctx.measureText(text);
    const t = ctx.getTransform();
    const xs = [x - m.actualBoundingBoxLeft, x + m.actualBoundingBoxRight];
    const ys = [y - m.actualBoundingBoxAscent, y + m.actualBoundingBoxDescent];
    const corners = xs.flatMap((cx) => ys.map((cy) => t.transformPoint({ x: cx, y: cy })));
    draw(ctx).texts.push({
      text,
      left: Math.min(...corners.map((c) => c.x)),
      right: Math.max(...corners.map((c) => c.x)),
      top: Math.min(...corners.map((c) => c.y)),
      bottom: Math.max(...corners.map((c) => c.y)),
    });
  };
  const { clearRect, fillText, strokeText } = proto;
  proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (x <= 0 && y <= 0 && x + w >= this.canvas.width && y + h >= this.canvas.height) drawn.delete(this.canvas);
    clearRect.call(this, x, y, w, h);
  };
  proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
    record(this, text, x, y);
    if (maxWidth === undefined) fillText.call(this, text, x, y);
    else fillText.call(this, text, x, y, maxWidth);
  };
  proto.strokeText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
    record(this, text, x, y);
    if (maxWidth === undefined) strokeText.call(this, text, x, y);
    else strokeText.call(this, text, x, y, maxWidth);
  };
}

/** Runs in the page: every text of every canvas' latest draw, in every cell (kit parts included), against its canvas. */
async function findCanvasViolations(page: Page): Promise<{ texts: Array<{ id: string; text: string }>; violations: Violation[] }> {
  return page.evaluate((tolerance) => {
    const drawn = (window as unknown as { __pwCanvasTexts?: CanvasTexts }).__pwCanvasTexts;
    if (drawn === undefined) return { texts: [], violations: [{ id: '-', problem: 'the canvas recorder did not run' }] };
    const texts: Array<{ id: string; text: string }> = [];
    const violations: { id: string; problem: string }[] = [];
    for (const figure of document.querySelectorAll<HTMLElement>('[data-gallery-id]')) {
      const id = figure.dataset['galleryId'] ?? '?';
      for (const canvas of figure.querySelectorAll('canvas')) {
        const slack = tolerance * window.devicePixelRatio;
        for (const t of drawn.get(canvas)?.texts ?? []) {
          texts.push({ id, text: t.text });
          const clipped = t.left < -slack || t.top < -slack || t.right > canvas.width + slack || t.bottom > canvas.height + slack;
          if (clipped) {
            const box = [t.left, t.top, t.right, t.bottom].map((v) => v.toFixed(1)).join(', ');
            violations.push({ id, problem: `canvas text "${t.text}" at [${box}] leaves its ${canvas.width} x ${canvas.height} canvas` });
          }
        }
      }
    }
    return { texts, violations };
  }, SUBPIXEL_PX);
}

/** Runs in the page: every cell's body is checked for scroll overflow of any element and for text laid out outside the body. */
async function findViolations(page: Page): Promise<{ ids: string[]; violations: Violation[] }> {
  return page.evaluate((tolerance) => {
    const violations: { id: string; problem: string }[] = [];
    const figures = [...document.querySelectorAll<HTMLElement>('[data-gallery-id]')];
    for (const figure of figures) {
      const id = figure.dataset['galleryId'] ?? '?';
      // The kit parts are not panels: they have no widget body to check.
      if (id.startsWith('kit/')) continue;
      const body = figure.querySelector<HTMLElement>('.panel .body');
      if (body === null) {
        violations.push({ id, problem: 'no widget body' });
        continue;
      }
      const box = body.getBoundingClientRect();
      for (const element of [body, ...body.querySelectorAll<HTMLElement>('*')]) {
        const name = `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className)}` : ''}`;
        if (element.scrollWidth > element.clientWidth) violations.push({ id, problem: `${name} scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth}` });
        if (element.scrollHeight > element.clientHeight) violations.push({ id, problem: `${name} scrollHeight ${element.scrollHeight} > clientHeight ${element.clientHeight}` });
      }
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        if (text.trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          const outside = r.left < box.left - tolerance || r.right > box.right + tolerance || r.top < box.top - tolerance || r.bottom > box.bottom + tolerance;
          if (outside) violations.push({ id, problem: `text "${text.trim().slice(0, 40)}" laid out outside the body` });
        }
      }
    }
    return { ids: figures.map((f) => f.dataset['galleryId'] ?? '?'), violations };
  }, SUBPIXEL_PX);
}

test.describe('fit', () => {
  let gallery: GalleryHandle;
  test.beforeAll(async () => {
    gallery = await openGallery({ initScript: recordCanvasTexts });
    await gallery.page.evaluate(() => document.fonts.ready);
  });
  test.afterAll(async () => {
    await gallery.close();
  });

  test('the gallery has the cells the fit declarations promise', async () => {
    const { ids } = await findViolations(gallery.page);
    // feed-status declares compact and full minimums plus three in-between sizes (its gallery.ts `fit`).
    for (const size of ['compact', 'compact-36x4', 'compact-47x7', 'full', 'full-64x12']) {
      expect(ids.some((id) => id.startsWith(`feed-status/${size}/`)), `a feed-status cell at ${size}`).toBe(true);
    }
    expect(ids.some((id) => id.startsWith('frame/'))).toBe(true);
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length);
  });

  test('the gallery page scrolls by hand (the no-scroll rule is the app window\'s only)', async () => {
    const scrolled = await gallery.page.evaluate(() => {
      const page = document.scrollingElement ?? document.documentElement;
      page.scrollTop = 0;
      window.scrollBy(0, 400);
      const moved = page.scrollTop;
      page.scrollTop = 0;
      return { tall: page.scrollHeight > window.innerHeight, moved };
    });
    expect(scrolled).toEqual({ tall: true, moved: 400 });
  });

  test('no element in any widget body overflows and no text is clipped', async () => {
    const { ids, violations } = await findViolations(gallery.page);
    // The frame cells show states of the panel, not widget sizes, and every one of them has a body too.
    expect(ids.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  test('no text a chart draws on its canvas is clipped: axis labels, ticks and line labels lie inside the canvas', async () => {
    const { texts, violations } = await findCanvasViolations(gallery.page);
    // The recorder sees the charts' texts: the gap chart's x axis label in a cell of the widget, and the kit chart's.
    expect(texts.some((t) => t.id.startsWith('gap-chart/') && t.text === 'lap'), 'a gap-chart cell draws its x label').toBe(true);
    expect(texts.some((t) => t.id.startsWith('kit/chart') && t.text === 'lap'), 'a kit chart cell draws its x label').toBe(true);
    expect(violations).toEqual([]);
  });
});
