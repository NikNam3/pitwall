// End to end (plan task 36, milestone "car"): the default car workbook, seeded by the bridge, on a replay of the
// committed segment `race-zandvoort-full-lap` (a normal race; car 1, the player, crosses into lap 10 at session time
// 723.368 and drives the whole lap). The spec jumps to that crossing, checks the corner block's readings, then plays.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeDataDir, openWorkbook, panelOf, removeDataDir, workbookFile } from './support.ts';
import { launchPitwall, startBridge } from './harness.ts';

const RECORDING = 'race-zandvoort-full-lap';
/** The jump target: car 1 crosses into lap 10 at 723.368, 1.4 s into the segment. */
const JUMP_LAP = '10';
const SETTLE_MS = 30_000;
/** The panels of the approved car layout (docs/brainstorms/2026-10-29-sp3-displays/4-layouts.html, "car"), in any order. */
const CAR_WIDGETS = ['alarm-list', 'corner-block', 'damage-card', 'ers-budget', 'fuel-gauge', 'tyre-life-bar'];

const cleanups: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.().catch(() => undefined);
});

/** The corner-block panel. */
const cornerPanel = (page: Page) => panelOf(page, 'corner-block');

/** The four corner rows of the full corner block: `FL  93  93  30.2  309  0%` split into fields. */
async function cornerRows(page: Page): Promise<Record<string, string[]>> {
  const lines = await cornerPanel(page).locator('.line').allInnerTexts();
  const rows: Record<string, string[]> = {};
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    const name = fields[0]?.toLowerCase();
    if (name === 'fl' || name === 'fr' || name === 'rl' || name === 'rr') rows[name] = fields.slice(1);
  }
  return rows;
}
const column = (rows: Record<string, string[]>, index: number): string[] => ['fl', 'fr', 'rl', 'rr'].map((c) => rows[c]?.[index] ?? '');
const SURFACE = 0, BRAKE = 3;

test('the car workbook is seeded, shows four known surface temperatures and live brake temperatures', async () => {
  const dataDir = await makeDataDir();
  cleanups.push(() => removeDataDir(dataDir));
  const bridge = await startBridge({ recording: RECORDING, dataDir });
  cleanups.push(() => bridge.stop());

  // The bridge seeded car.json: its panels are the approved layout's.
  const workbook = JSON.parse(await readFile(workbookFile(dataDir, 'car'), 'utf8')) as {
    name: string; windows: Array<{ panels: Record<string, { widget: string }> }>;
  };
  expect(workbook.name).toBe('car');
  const widgets = workbook.windows.flatMap((w) => Object.values(w.panels).map((p) => p.widget)).sort();
  expect(widgets).toEqual(CAR_WIDGETS);

  const app = await launchPitwall({ wsPort: bridge.wsPort, dataDir });
  cleanups.push(() => app.close());
  const page = await app.window('main');
  await page.bringToFront();
  // The bridge seeds car, quali and race: open car by name.
  await openWorkbook(page, 'car');
  await expect(cornerPanel(page).locator('.line', { hasText: /\bSURF\b/ })).toBeVisible({ timeout: SETTLE_MS });

  // The top bar names the workbook; a click on it opens the picker.
  await expect(page.getByTestId('workbook-name')).toHaveText('car');
  await page.getByTestId('workbook-name').click();
  await expect(page.getByTestId('workbook-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workbook-picker')).toBeHidden();

  // The settings popover of the panel nearest the window's right edge opens inside the window.
  const gears = page.locator('button:has([aria-label="settings"])');
  const rights = await gears.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  const rightmost = rights.indexOf(Math.max(...rights));
  await gears.nth(rightmost).click();
  const popover = page.getByTestId('overlay');
  await expect(popover).toBeVisible();
  const inside = await popover.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  });
  expect(inside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  // Whatever pokes past the window's edge, the page itself never scrolls (no browser scrollbars, white by default),
  // and inner scroll areas get the dark scheme's scrollbars (user, live test 2026-10-30).
  const page_ = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;width:200vw;height:200vh';
    document.body.appendChild(probe);
    const result = {
      scrollbars: window.innerWidth - document.documentElement.clientWidth + (window.innerHeight - document.documentElement.clientHeight),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    };
    probe.remove();
    return result;
  });
  expect(page_).toEqual({ scrollbars: 0, colorScheme: 'dark' });

  // The app route has the no-scroll rule (review 2, F5): the window class is set, the page clips (html and body), and
  // even with content taller and wider than the window a programmatic scroll moves nothing. Without the rule the probe
  // below would grow the page and scrollBy would move it.
  const noScroll = await page.evaluate(() => {
    const html = document.documentElement;
    const scroller = document.scrollingElement ?? html;
    const probe = document.createElement('div');
    probe.style.cssText = 'width:200vw;height:200vh';
    document.body.appendChild(probe);
    window.scrollBy(400, 400);
    const result = {
      windowClass: html.classList.contains('pw-window'),
      overflow: [getComputedStyle(html).overflow, getComputedStyle(document.body).overflow],
      moved: [scroller.scrollLeft, scroller.scrollTop],
    };
    window.scrollTo(0, 0);
    probe.remove();
    return result;
  });
  expect(noScroll).toEqual({ windowClass: true, overflow: ['hidden', 'hidden'], moved: [0, 0] });

  // Jump to the player's line crossing (the replay stays paused): the corner block shows four known surface temperatures.
  await page.getByTestId('replay-lap').fill(JUMP_LAP);
  await page.getByTestId('replay-lap').press('Enter');
  await page.getByTestId('replay-lap').blur();
  const known = (values: string[]): boolean => values.length === 4 && values.every((v) => /^\d{2,3}$/.test(v));
  await expect.poll(async () => known(column(await cornerRows(page), SURFACE)), { timeout: SETTLE_MS }).toBe(true);

  // The brakes keep moving: the readings are known numbers and change in at least one corner once the replay plays.
  await expect.poll(async () => column(await cornerRows(page), BRAKE).every((v) => /^\d{2,4}$/.test(v)), { timeout: SETTLE_MS }).toBe(true);
  const before = column(await cornerRows(page), BRAKE);
  await page.getByTestId('replay-pause').click();
  await expect.poll(async () => column(await cornerRows(page), BRAKE), { timeout: SETTLE_MS }).not.toEqual(before);
  for (const value of column(await cornerRows(page), BRAKE)) expect(value).toMatch(/^\d{2,4}$/);
});
