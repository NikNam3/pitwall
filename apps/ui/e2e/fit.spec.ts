// Fit (spec 9.3): in every gallery cell nothing in the widget body overflows and no text is clipped, the text a chart
// draws on its canvas included (review 7, R7-9: the gap chart's compact y label was cut to "behind referen"). A chart's
// axis label is measured against the plot it labels, not only the canvas (review 8, R8-2): the y label's length against
// the plot's height, the x label's against its width, where uPlot centres them; at a pixel ratio of 1 and of 1.25, where
// uPlot rounds the canvas font size (R8-3).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGallery } from './harness.ts';
import type { GalleryHandle } from './harness-contract.ts';

/** The tolerance of the browser's rounding; the gallery gives every box this much room (gallery/layout.ts SUBPIXEL_PX). */
const SUBPIXEL_PX = 0.5;

type Violation = { id: string; problem: string };

/**
 * A text drawn on a canvas, as the box its glyphs cover (canvas px, after the context's transform). `axis` marks a chart's
 * axis label, the way uPlot draws one: the y label rotated a quarter turn, the x label centred inside a `save()` (uPlot
 * draws its tick values unrotated and outside one, and the chart's line labels left-aligned).
 */
type DrawnText = { text: string; left: number; top: number; right: number; bottom: number; axis?: 'x' | 'y' };
/** The texts of each canvas' latest draw (a clear of the whole canvas, or a new canvas size, starts a new one). */
type CanvasTexts = Map<HTMLCanvasElement, { width: number; height: number; texts: DrawnText[] }>;

/**
 * Runs in the gallery page before its scripts: records every `fillText` and `strokeText` of a 2D canvas with the box of
 * its glyphs (`measureText`'s actual bounding box from the text's anchor, through the current transform, so a rotated
 * axis label counts too), per canvas, in `window.__pwCanvasTexts`.
 */
function recordCanvasTexts(): void {
  type Drawn = { text: string; left: number; top: number; right: number; bottom: number; axis?: 'x' | 'y' };
  const drawn = new Map<HTMLCanvasElement, { width: number; height: number; texts: Drawn[] }>();
  (window as unknown as { __pwCanvasTexts: typeof drawn }).__pwCanvasTexts = drawn;
  const proto = CanvasRenderingContext2D.prototype;
  // How many `save()`s of each context are open.
  const saved = new WeakMap<CanvasRenderingContext2D, number>();
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
    const rotated = Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9;
    const axis = rotated ? 'y' : ctx.textAlign === 'center' && (saved.get(ctx) ?? 0) > 0 ? 'x' : undefined;
    draw(ctx).texts.push({
      text,
      left: Math.min(...corners.map((c) => c.x)),
      right: Math.max(...corners.map((c) => c.x)),
      top: Math.min(...corners.map((c) => c.y)),
      bottom: Math.max(...corners.map((c) => c.y)),
      ...(axis === undefined ? {} : { axis }),
    });
  };
  const { clearRect, fillText, strokeText, save, restore } = proto;
  proto.save = function (this: CanvasRenderingContext2D): void {
    saved.set(this, (saved.get(this) ?? 0) + 1);
    save.call(this);
  };
  proto.restore = function (this: CanvasRenderingContext2D): void {
    saved.set(this, Math.max(0, (saved.get(this) ?? 0) - 1));
    restore.call(this);
  };
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

type AxisLabel = { id: string; text: string; axis: 'x' | 'y' };

/**
 * Runs in the page: every axis label of every chart's latest draw, in every cell (kit parts included), against the plot
 * it labels. The plot is uPlot's: its `.u-over` layer covers exactly the plot box, read in canvas px. A y label's extent
 * along the plot's height, an x label's along its width, must lie within the plot.
 */
async function findAxisLabelViolations(page: Page): Promise<{ labels: AxisLabel[]; violations: Violation[] }> {
  return page.evaluate((tolerance) => {
    const drawn = (window as unknown as { __pwCanvasTexts?: CanvasTexts }).__pwCanvasTexts;
    if (drawn === undefined) return { labels: [], violations: [{ id: '-', problem: 'the canvas recorder did not run' }] };
    const labels: AxisLabel[] = [];
    const violations: { id: string; problem: string }[] = [];
    for (const figure of document.querySelectorAll<HTMLElement>('[data-gallery-id]')) {
      const id = figure.dataset['galleryId'] ?? '?';
      for (const chart of figure.querySelectorAll<HTMLElement>('.uplot')) {
        const canvas = chart.querySelector('canvas');
        const over = chart.querySelector('.u-over');
        if (canvas === null || over === null) {
          violations.push({ id, problem: 'a chart without its canvas or its plot layer (.u-over)' });
          continue;
        }
        const box = canvas.getBoundingClientRect();
        const scale = canvas.width / box.width;
        const o = over.getBoundingClientRect();
        const plot = { left: (o.left - box.left) * scale, top: (o.top - box.top) * scale, right: (o.right - box.left) * scale, bottom: (o.bottom - box.top) * scale };
        const slack = tolerance * scale;
        for (const t of drawn.get(canvas)?.texts ?? []) {
          if (t.axis === undefined) continue;
          labels.push({ id, text: t.text, axis: t.axis });
          const [from, to, lo, hi, along] =
            t.axis === 'y' ? [t.top, t.bottom, plot.top, plot.bottom, 'height'] : [t.left, t.right, plot.left, plot.right, 'width'];
          if (from < lo - slack || to > hi + slack) {
            const span = (a: number, b: number): string => `${a.toFixed(1)} to ${b.toFixed(1)}`;
            violations.push({ id, problem: `${t.axis} label "${t.text}" spans ${span(from, to)}, past the plot's ${along} ${span(lo, hi)}` });
          }
        }
      }
    }
    return { labels, violations };
  }, SUBPIXEL_PX);
}

/**
 * Runs in the page: adds a cell `probe/axis-labels` that holds a chart's DOM as uPlot builds it (a `.uplot` with its
 * canvas and a `.u-over` over a 100 x 100 CSS px plot in a 400 x 300 canvas) and draws on it as uPlot draws axis labels:
 * a y label and an x label each 200 CSS px long (inside the canvas, longer than the plot), and a short one of each.
 */
async function addAxisLabelProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const figure = document.createElement('figure');
    figure.dataset['galleryId'] = 'probe/axis-labels';
    const chart = figure.appendChild(document.createElement('div'));
    chart.className = 'uplot';
    const wrap = chart.appendChild(document.createElement('div'));
    wrap.className = 'u-wrap';
    Object.assign(wrap.style, { position: 'relative', width: '400px', height: '300px' });
    const canvas = wrap.appendChild(document.createElement('canvas'));
    const ratio = window.devicePixelRatio;
    canvas.width = 400 * ratio;
    canvas.height = 300 * ratio;
    Object.assign(canvas.style, { display: 'block', width: '400px', height: '300px' });
    const over = wrap.appendChild(document.createElement('div'));
    over.className = 'u-over';
    // The plot: x from 100 to 200, y from 100 to 200 (CSS px); its centre is where uPlot centres each label.
    Object.assign(over.style, { position: 'absolute', left: '100px', top: '100px', width: '100px', height: '100px' });
    document.body.appendChild(figure);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2D context');
    // 20 px monospace: 0.6 em a character, so 'y'.repeat(17) is about 200 px and 'y' 12 px.
    ctx.font = `${20 * ratio}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const yLabel = (text: string): void => {
      ctx.save();
      ctx.translate(60 * ratio, 150 * ratio);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    const xLabel = (text: string): void => {
      ctx.save();
      ctx.fillText(text, 150 * ratio, 280 * ratio);
      ctx.restore();
    };
    yLabel('y long label 0123');
    xLabel('x long label 0123');
    yLabel('y');
    xLabel('x');
  });
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

  test('the gallery window draws at a pixel ratio of 1, its charts too', async () => {
    expect(await pixelRatios(gallery.page)).toEqual({ ratio: 1, charts: true });
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

  test('the axis-label check fails a label longer than its plot that stays inside the canvas', async () => {
    await addAxisLabelProbe(gallery.page);
    try {
      const probe = (v: Violation): boolean => v.id === 'probe/axis-labels';
      const { labels, violations } = await findAxisLabelViolations(gallery.page);
      expect(labels.filter((l) => l.id === 'probe/axis-labels').map((l) => `${l.axis} ${l.text}`).sort()).toEqual(
        ['x x', 'x x long label 0123', 'y y', 'y y long label 0123'],
      );
      const flagged = violations.filter(probe).map((v) => v.problem.slice(0, v.problem.indexOf('"', 9) + 1));
      expect(flagged.sort()).toEqual(['x label "x long label 0123"', 'y label "y long label 0123"']);
      // The canvas check alone lets both through: they lie inside the canvas.
      expect((await findCanvasViolations(gallery.page)).violations.filter(probe)).toEqual([]);
    } finally {
      await gallery.page.evaluate(() => document.querySelector('[data-gallery-id="probe/axis-labels"]')?.remove());
    }
  });

  test("every chart's axis labels fit the plot they label, in every cell", async () => {
    await expectAxisLabelsFit(gallery.page);
  });
});

/** The page's pixel ratio, and whether every chart canvas has that many backing pixels per CSS pixel (there is one). */
async function pixelRatios(page: Page): Promise<{ ratio: number; charts: boolean }> {
  return page.evaluate(() => {
    const ratio = window.devicePixelRatio;
    const charts = [...document.querySelectorAll<HTMLCanvasElement>('.uplot canvas')].map((c) => c.width / c.getBoundingClientRect().width);
    return { ratio, charts: charts.length > 0 && charts.every((r) => Math.abs(r - ratio) < 0.01) };
  });
}

/** Every axis label of the gallery fits its plot; the check sees both labels of the gap chart and of the kit chart. */
async function expectAxisLabelsFit(page: Page): Promise<void> {
  const { labels, violations } = await findAxisLabelViolations(page);
  const has = (prefix: string, axis: 'x' | 'y'): boolean => labels.some((l) => l.id.startsWith(prefix) && l.axis === axis && l.text !== '');
  expect(has('gap-chart/', 'x'), 'a gap-chart cell draws its x label').toBe(true);
  expect(has('gap-chart/', 'y'), 'a gap-chart cell draws its y label').toBe(true);
  expect(has('kit/chart', 'x'), 'a kit chart cell draws its x label').toBe(true);
  expect(has('kit/chart', 'y'), 'a kit chart cell draws its y label').toBe(true);
  expect(violations).toEqual([]);
}

// At a pixel ratio of 1.25 uPlot draws a 14 px label font at 18 px and a 13 px one at 16 px (it rounds the canvas font
// size): the label fit must measure what is drawn (R8-3).
test.describe('fit at a pixel ratio of 1.25', () => {
  let gallery: GalleryHandle;
  test.beforeAll(async () => {
    gallery = await openGallery({ initScript: recordCanvasTexts, deviceScaleFactor: 1.25 });
    await gallery.page.evaluate(() => document.fonts.ready);
  });
  test.afterAll(async () => {
    await gallery.close();
  });

  test('the gallery window draws at a pixel ratio of 1.25, its charts too', async () => {
    expect(await pixelRatios(gallery.page)).toEqual({ ratio: 1.25, charts: true });
  });

  test('no text a chart draws on its canvas leaves the canvas', async () => {
    expect((await findCanvasViolations(gallery.page)).violations).toEqual([]);
  });

  test("every chart's axis labels fit the plot they label, in every cell", async () => {
    await expectAxisLabelsFit(gallery.page);
  });
});
