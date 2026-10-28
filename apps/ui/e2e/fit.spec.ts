// Fit (spec 9.3): in every gallery cell nothing in the widget body overflows and no text is clipped.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGallery } from './harness.ts';
import type { GalleryHandle } from './harness-contract.ts';

/** The tolerance of the browser's rounding; the gallery gives every box this much room (gallery/layout.ts SUBPIXEL_PX). */
const SUBPIXEL_PX = 0.5;

type Violation = { id: string; problem: string };

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
    gallery = await openGallery();
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

  test('no element in any widget body overflows and no text is clipped', async () => {
    const { ids, violations } = await findViolations(gallery.page);
    // The frame cells show states of the panel, not widget sizes, and every one of them has a body too.
    expect(ids.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
