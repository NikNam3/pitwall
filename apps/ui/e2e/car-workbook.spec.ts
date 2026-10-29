// End to end (plan task 36, milestone "car"): the default car workbook, seeded by the bridge, on a replay of the
// full time-trial recording `ttZandvoort` (PITWALL_FIXTURES_DIR). Spec 13.6: the time trial holds tyre surface at
// 93 degC from lap 2 and only the brake temperatures change, so those two are what this spec can check.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeDataDir, removeDataDir, workbookFile } from './support.ts';
import { launchPitwall, startBridge } from './harness.ts';

const RECORDING = 'ttZandvoort';
const SETTLE_MS = 30_000;
/** The panels of the approved car layout (docs/brainstorms/2026-10-29-sp3-displays/4-layouts.html, "car"), in any order. */
const CAR_WIDGETS = ['alarm-list', 'corner-block', 'damage-card', 'ers-budget', 'fuel-gauge', 'tyre-life-bar'];

const cleanups: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.().catch(() => undefined);
});

/** The four corner rows of the full corner block: `FL  93  93  30.2  309  0%` split into fields. */
async function cornerRows(page: Page): Promise<Record<string, string[]>> {
  const lines = await page.locator('.panel .line').allInnerTexts();
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
  // `car` is the only workbook in a fresh data dir, so it is workbook 1.
  await page.keyboard.press('Control+1');
  await expect(page.getByText('SURF')).toBeVisible({ timeout: SETTLE_MS });

  // From lap 2 the time trial holds the surface temperature at 93 degC: jump there and play.
  await page.getByTestId('replay-lap').fill('2');
  await page.getByTestId('replay-lap').press('Enter');
  await page.getByTestId('replay-lap').blur();
  await page.getByTestId('replay-pause').click();
  await expect.poll(async () => column(await cornerRows(page), SURFACE), { timeout: SETTLE_MS }).toEqual(['93', '93', '93', '93']);

  // The brakes keep moving: the readings now and 10 s later differ in at least one corner, and all are known numbers.
  const before = column(await cornerRows(page), BRAKE);
  await page.waitForTimeout(10_000);
  const after = column(await cornerRows(page), BRAKE);
  for (const value of [...before, ...after]) expect(value).toMatch(/^\d{2,4}$/);
  expect(after).not.toEqual(before);
});
