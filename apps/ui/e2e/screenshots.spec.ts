// Screenshots (spec 9.3): the gallery cells marked `data-baseline` against their committed baselines in
// `__screenshots__/`, zero differing pixels. Few on purpose (user decision): per widget its first case at each mode's
// minimum in the default theme (gallery/cells.ts `hasBaseline`), plus the panel frame states, the kit parts and the
// shell cells. The gallery still draws every case and theme, and fit.spec.ts checks all of them.
import { expect, test } from '@playwright/test';
import { openGallery } from './harness.ts';
import { SHELL_CELLS } from '../src/gallery/cells.ts';
import type { GalleryHandle } from './harness-contract.ts';

/** `feed-status/compact/disconnected/quiet` to a file name. */
const fileOf = (id: string): string => `${id.replaceAll('/', '__')}.png`;

test.describe('screenshots', () => {
  let gallery: GalleryHandle;
  test.beforeAll(async () => {
    gallery = await openGallery();
  });
  test.afterAll(async () => {
    await gallery.close();
  });

  test('every baseline cell matches its baseline', async () => {
    const { page } = gallery;
    await page.evaluate(() => document.fonts.ready);
    const ids = await page.$$eval('[data-gallery-id][data-baseline]', (figures) => figures.map((f) => (f as HTMLElement).dataset['galleryId'] ?? '?'));
    expect(ids.length).toBeGreaterThan(0);
    // The shell's cells (top bar, palette, key overview, settings popover, inspector) are declared in cells.ts.
    for (const cell of SHELL_CELLS) expect.soft(ids, `the gallery draws ${cell.id} with a baseline`).toContain(cell.id);
    // Playwright sanitises names further; two ids must never end up sharing one baseline file.
    const sanitised = ids.map((id) => fileOf(id).replace(/[^a-zA-Z0-9_.]+/g, '-'));
    expect(new Set(sanitised).size, 'baseline file names are unique').toBe(ids.length);
    for (const id of ids) {
      const cell = page.locator(`[data-gallery-id="${id}"]`);
      await cell.scrollIntoViewIfNeeded();
      await expect.soft(cell, id).toHaveScreenshot(fileOf(id), { maxDiffPixels: 0 });
    }
  });
});
