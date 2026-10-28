// Screenshots (spec 9.3): every gallery cell against its committed baseline in `__screenshots__/`, zero differing pixels.
import { expect, test } from '@playwright/test';
import { openGallery } from './harness.ts';
import type { GalleryHandle } from './harness-contract.ts';

/** `feed-status/compact/ttZandvoortLap1.crossing/black` to a file name. */
const fileOf = (id: string): string => `${id.replaceAll('/', '__')}.png`;

test.describe('screenshots', () => {
  let gallery: GalleryHandle;
  test.beforeAll(async () => {
    gallery = await openGallery();
  });
  test.afterAll(async () => {
    await gallery.close();
  });

  test('every cell matches its baseline', async () => {
    const { page } = gallery;
    await page.evaluate(() => document.fonts.ready);
    const ids = await page.$$eval('[data-gallery-id]', (figures) => figures.map((f) => (f as HTMLElement).dataset['galleryId'] ?? '?'));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const cell = page.locator(`[data-gallery-id="${id}"]`);
      await cell.scrollIntoViewIfNeeded();
      await expect.soft(cell, id).toHaveScreenshot(fileOf(id), { maxDiffPixels: 0 });
    }
  });
});
