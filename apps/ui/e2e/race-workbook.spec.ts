// End to end (plan task 37, milestone "race"): the default race workbook, seeded by the bridge, on a replay of the
// full race recording `raceSingapore` (PITWALL_FIXTURES_DIR). The timing tower shows all 20 cars and the incident feed
// shows a collision before session time 79 s.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { makeDataDir, openWorkbook, panelOf, removeDataDir, workbookFile } from './support.ts';
import { launchPitwall, startBridge } from './harness.ts';

const RECORDING = 'raceSingapore';
const SETTLE_MS = 30_000;
/** Real time the replay may need to reach 79 s of session time at 8x, with margin. */
const PLAY_MS = 60_000;
const COLLISION_BEFORE_MS = 79_000;

/** The panels of the approved race layout (docs/brainstorms/2026-10-29-sp3-displays/4-layouts.html, "race"): main = timing and race awareness, side = car care. */
const MAIN_WIDGETS = ['battle-cards', 'gap-chart', 'incident-feed', 'timing-tower'];
const SIDE_WIDGETS = ['alarm-list', 'corner-block', 'damage-card', 'ers-budget', 'fuel-gauge', 'tyre-life-bar'];

const cleanups: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.().catch(() => undefined);
});

type WorkbookFile = { name: string; windows: Array<{ id: string; panels: Record<string, { widget: string }> }> };

test('the race workbook is seeded, opens by name, shows 20 tower rows and an early collision', async () => {
  const dataDir = await makeDataDir();
  cleanups.push(() => removeDataDir(dataDir));
  const bridge = await startBridge({ recording: RECORDING, dataDir });
  cleanups.push(() => bridge.stop());

  // The bridge seeded race.json: its panels per window are the approved layout's.
  const workbook = JSON.parse(await readFile(workbookFile(dataDir, 'race'), 'utf8')) as WorkbookFile;
  expect(workbook.name).toBe('race');
  const widgetsOf = (id: string): string[] => {
    const panels = workbook.windows.find((w) => w.id === id)?.panels;
    return (panels === undefined ? [] : Object.values(panels)).map((p) => p.widget).sort();
  };
  expect(widgetsOf('main')).toEqual(MAIN_WIDGETS);
  expect(widgetsOf('side')).toEqual(SIDE_WIDGETS);

  const app = await launchPitwall({ wsPort: bridge.wsPort, dataDir });
  cleanups.push(() => app.close());
  const page = await app.window('main');
  await page.bringToFront();

  // Open the workbook by name through the picker (Ctrl+O), not by its position.
  await openWorkbook(page, 'race');

  // The tower shows every car: header row excluded, 20 rows.
  const towerRows = panelOf(page, 'timing-tower').locator('.row:not(.head)');
  await expect(towerRows).toHaveCount(20, { timeout: SETTLE_MS });

  // Play at 8x until a collision entry (feed id `collision:<cars>:<sessionTime ms>`) with session time < 79 s appears.
  await page.getByTestId('replay-speed').selectOption('8');
  await page.getByTestId('replay-pause').click();
  const collisionTimes = async (): Promise<number[]> => {
    const ids = await page.locator('[data-testid^="incident-collision:"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    return ids.map((id) => Number(id.slice(id.lastIndexOf(':') + 1)));
  };
  await expect.poll(async () => (await collisionTimes()).some((t) => t < COLLISION_BEFORE_MS), { timeout: PLAY_MS }).toBe(true);
  // The row's wording is the kit's: the collision kind (kit/text.ts `incidentKinds.collision`).
  await expect(page.locator('[data-testid^="incident-collision:"]').first()).toContainText('collision');
  await expect(towerRows).toHaveCount(20);
});
