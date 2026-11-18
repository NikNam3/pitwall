// End to end (SP4.3e Task 7c-2, spec §4.2): confirm a basis and a plan in the shell's picker, the top bar follows.
// One data dir, two bridges in turn: the first replays the committed segment `qualifying-texas-send` (the end of the
// Texas one-shot qualifying of 2026-11-17, through SEND) to its end, so the qualifying is stored; the second replays
// `race-texas-grid` (the race of that weekend: the weekend phase and the team are known from 1.526 s) to its end, so
// the race's basis is preselected: its own weekend's qualifying. In the app the command "Basis and plan…" (palette,
// C72) opens the picker; confirming qualifying none and plan none sends `basis.choose`, and the top bar's basis
// segment reads none; confirming the qualifying again brings its day back. Saved plans need a planning round, which
// this spec does not open: the plan chosen is none both times.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { launchPitwall, startBridge } from './harness.ts';
import { makeDataDir, removeDataDir } from './support.ts';

const QUALIFYING = 'qualifying-texas-send';
const RACE = 'race-texas-grid';
const SETTLE_MS = 30_000;
const POLL_MS = 200;
/** A day as the top bar writes it (`formatDay`): `17 Nov`. */
const DAY = /\d{1,2} [A-Z][a-z]{2}/;

const cleanups: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.().catch(() => undefined);
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Plays the bridge's replay feed and resolves once it is at its end. */
async function playToEnd(port: number): Promise<void> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: Array<{ type: string; id?: string; value?: unknown; feeds?: Array<{ feedId: string; kind: string }> }> = [];
  socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data)) as (typeof messages)[number]));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`no WebSocket on ${port}`)), { once: true });
  });
  try {
    const deadline = Date.now() + SETTLE_MS;
    let feedId: string | undefined;
    while (feedId === undefined && Date.now() < deadline) {
      feedId = messages.find((m) => m.type === 'hello')?.feeds?.find((f) => f.kind === 'replay')?.feedId;
      if (feedId === undefined) await sleep(POLL_MS);
    }
    if (feedId === undefined) throw new Error('the bridge offers no replay feed');
    socket.send(JSON.stringify({ type: 'replayControl', id: 'play', control: { kind: 'play' } }));
    socket.send(JSON.stringify({ type: 'subscribe', id: 'status', topic: 'replay.status', params: {}, feedId }));
    while (Date.now() < deadline) {
      const last = messages.filter((m) => m.id === 'status' && (m.type === 'snapshot' || m.type === 'update')).at(-1);
      if ((last?.value as { atEnd?: boolean } | undefined)?.atEnd === true) return;
      await sleep(POLL_MS);
    }
    throw new Error('the replay did not reach its end');
  } finally {
    socket.close();
  }
}

/** The top bar's basis segment. */
const basisSegment = (page: Page) => page.getByTestId('segment-basis');

/** Runs "Basis and plan…" from the palette (Ctrl+K) and resolves with the picker. */
async function openPicker(page: Page) {
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Basis and plan');
  await page.keyboard.press('Enter');
  const picker = page.getByTestId('basis-picker');
  await expect(picker).toBeVisible({ timeout: SETTLE_MS });
  return picker;
}

test('confirming a basis and a plan in the picker updates the top bar', async () => {
  const dataDir = await makeDataDir();
  cleanups.push(() => removeDataDir(dataDir));

  // The qualifying, replayed to its end: stored in the data dir.
  const first = await startBridge({ recording: QUALIFYING, dataDir });
  await playToEnd(first.wsPort);
  await first.stop();

  // The race of that weekend: its basis is preselected from the stored qualifying.
  const bridge = await startBridge({ recording: RACE, dataDir });
  cleanups.push(() => bridge.stop());
  await playToEnd(bridge.wsPort);
  const app = await launchPitwall({ wsPort: bridge.wsPort, dataDir });
  cleanups.push(() => app.close());
  const page = await app.window('main');
  await page.bringToFront();

  const segment = basisSegment(page);
  await expect(segment).toHaveText(new RegExp(`Qualifying ${DAY.source}`), { timeout: SETTLE_MS });
  const preselected = (await segment.innerText()).replace(/\s+/g, ' ').trim();

  // Qualifying none, plan none: the top bar follows once the bridge publishes the choice (C73).
  let picker = await openPicker(page);
  await picker.getByTestId('qualifying-none').check();
  await picker.getByTestId('plan-none').check();
  await picker.getByTestId('basis-confirm').click();
  await expect(picker).toBeHidden({ timeout: SETTLE_MS });
  await expect(segment).toContainText('Qualifying none', { timeout: SETTLE_MS });
  await expect(segment).toContainText('Plan: none');

  // The qualifying again: its day is back, as preselected.
  picker = await openPicker(page);
  const qualifying = picker.locator('[data-testid^="qualifying-"]:not([data-testid="qualifying-none"])');
  await expect(qualifying).toHaveCount(1);
  await qualifying.check();
  await picker.getByTestId('basis-confirm').click();
  await expect(picker).toBeHidden({ timeout: SETTLE_MS });
  await expect(segment).toHaveText(new RegExp(`Qualifying ${DAY.source}`), { timeout: SETTLE_MS });
  expect((await segment.innerText()).replace(/\s+/g, ' ').trim()).toBe(preselected);
});
