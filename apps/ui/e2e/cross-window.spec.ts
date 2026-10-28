// End to end (spec 9.3): a bridge replaying tt-zandvoort-lap1 (paused) and Electron with two windows, `main` and `side`.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editWorkbook, feedStatus, makeDataDir, marker, removeDataDir, subscribeLines, twoWindows, unknownWidgetText, writeWorkbook } from './support.ts';
import { launchPitwall, startBridge } from './harness.ts';
import type { BridgeHandle, PitwallApp } from './harness-contract.ts';

const RECORDING = 'tt-zandvoort-lap1';
const CRITICAL_KEY = 'e2e-critical';
/** Generous: the bridge and Electron start, the first snapshot arrives. */
const SETTLE_MS = 20_000;

type Setup = { dataDir: string; bridge: BridgeHandle; app: PitwallApp; main: Page; side: Page };

/** The default workbook has windows main and side; the second workbook ("other", Ctrl+2) marks each with an unknown widget. */
async function setup(insight?: string): Promise<Setup> {
  const dataDir = await makeDataDir();
  await writeWorkbook(dataDir, 'default', twoWindows());
  await writeWorkbook(dataDir, 'other', [
    { id: 'main', panels: { a: marker('e2e-other-main') } },
    { id: 'side', panels: { a: marker('e2e-other-side') } },
  ]);
  const bridge = await startBridge({ recording: RECORDING, dataDir, insight });
  const app = await launchPitwall({ wsPort: bridge.wsPort, dataDir });
  // `main` opens `side` itself, from the workbook.
  const main = await app.window('main');
  const side = await app.window('side');
  return { dataDir, bridge, app, main, side };
}

async function teardown(s: Setup | undefined): Promise<void> {
  if (s === undefined) return;
  await s.app.close();
  await s.bridge.stop();
  await removeDataDir(s.dataDir);
}

const connected = (page: Page) => page.getByText(/^connected$/);
const stale = (page: Page) => page.getByText(/^stale/);

test.describe('two windows on a paused replay', () => {
  let s: Setup | undefined;
  test.afterEach(async () => {
    await teardown(s);
    s = undefined;
  });

  test('the placeholder shows connected and the track in both windows', async () => {
    s = await setup();
    for (const page of [s.main, s.side]) {
      await expect(connected(page)).toBeVisible({ timeout: SETTLE_MS });
      await expect(page.getByText(/Zandvoort/)).toBeVisible({ timeout: SETTLE_MS });
    }
  });

  test('Ctrl+2 in main switches the workbook in both windows', async () => {
    s = await setup();
    await expect(connected(s.main)).toBeVisible({ timeout: SETTLE_MS });
    await s.main.bringToFront();
    await s.main.keyboard.press('Control+2');
    await expect(s.main.getByText(unknownWidgetText('e2e-other-main'))).toBeVisible({ timeout: SETTLE_MS });
    await expect(s.side.getByText(unknownWidgetText('e2e-other-side'))).toBeVisible({ timeout: SETTLE_MS });
    await expect(connected(s.main)).toHaveCount(0);
    await expect(connected(s.side)).toHaveCount(0);
  });

  test('an injected critical insight is acknowledged in main and disappears in side', async () => {
    s = await setup(CRITICAL_KEY);
    const alert = (page: Page) => page.getByTestId(`alert-${CRITICAL_KEY}`);
    await expect(alert(s.main)).toBeVisible({ timeout: SETTLE_MS });
    await expect(alert(s.side)).toBeVisible({ timeout: SETTLE_MS });
    await s.main.getByTestId(`alert-ack-${CRITICAL_KEY}`).click();
    await expect(alert(s.main)).toHaveCount(0);
    await expect(alert(s.side)).toHaveCount(0);
  });

  test('a restarted bridge turns both windows stale, then they recover without duplicate subscriptions', async () => {
    s = await setup();
    await expect(connected(s.main)).toBeVisible({ timeout: SETTLE_MS });
    await expect(connected(s.side)).toBeVisible({ timeout: SETTLE_MS });
    await s.bridge.stop();
    await expect(stale(s.main).first()).toBeVisible({ timeout: SETTLE_MS });
    await expect(stale(s.side).first()).toBeVisible({ timeout: SETTLE_MS });
    await s.bridge.restart();
    for (const page of [s.main, s.side]) {
      await expect(connected(page)).toBeVisible({ timeout: SETTLE_MS });
      await expect(stale(page)).toHaveCount(0, { timeout: SETTLE_MS });
    }
    // The log of the restarted bridge: each window (one connection each) subscribed once per topic and params.
    const lines = subscribeLines(s.bridge.log());
    expect(lines.length).toBeGreaterThan(0);
    const clients = new Set(lines.map((l) => l.clientId));
    expect(clients.size, 'one connection per window').toBe(2);
    const seen = new Set<string>();
    for (const l of lines) {
      const key = `${l.clientId}|${l.topic}|${JSON.stringify(l.params ?? null)}|${l.feedId ?? ''}`;
      expect(seen.has(key), `duplicate subscription ${key}`).toBe(false);
      seen.add(key);
    }
    const ids = lines.map((l) => `${l.clientId}|${l.id}`);
    expect(new Set(ids).size, 'subscription ids are unique per connection').toBe(ids.length);
  });

  test('a hand edit of the active workbook file changes the layout in both windows', async () => {
    s = await setup();
    await expect(connected(s.main)).toBeVisible({ timeout: SETTLE_MS });
    await editWorkbook(s.dataDir, 'default', [
      { id: 'main', panels: { feed: feedStatus, extra: marker('e2e-extra') } },
      { id: 'side', panels: { edited: marker('e2e-edited-side') } },
    ]);
    await expect(s.main.getByText(unknownWidgetText('e2e-extra'))).toBeVisible({ timeout: SETTLE_MS });
    await expect(s.main.getByText(/^connected$/)).toBeVisible();
    await expect(s.side.getByText(unknownWidgetText('e2e-edited-side'))).toBeVisible({ timeout: SETTLE_MS });
    await expect(connected(s.side)).toHaveCount(0);
  });
});
