// End to end, case B in the panel (SP4.3f Task 8, spec §4.5, G1, G7; C38, C62d, C84): planning a race out of session.
// A fresh data dir holds two synthetic recordings (`test-support/recordings`), imported with `pitwall import`: a
// practice and a qualifying of team 0 (#64 in slot 0, the player, and #2 in slot 1) on track 15, weekend W; the
// qualifying's Session packets carry the race's samples +0 light cloud 12 %, +15 light cloud 12 %, +30 light rain 45 %.
// A bridge with no session (`pitwall live` on its own UDP port, never 20777/20778, no traffic) serves the panel. Steps:
//   1. no `session.info`;
//   2. the top bar's `Plan…` opens the picker: the qualifying listed as `<day> · Mercedes #64 #2` and preselected with
//      the practice; confirm;
//   3. Ctrl+O to the `plan` workbook: the board of link group 1 (`player`) shows ranked rows for #64 (slot 0); LAPS 5
//      (the job stays short); RAIN 45 % with `imported · Q <day>`;
//   4. the conditions: +30 to rain 80, committed: the computing mark appears and goes, the label reads `edited`;
//   5. the plan saved as `E2E plan` (a `plans.save` uiAction: the panel has no save control, see the report);
//   6. the bridge restarted on the same ports and data dir (Review focus 5): the saved plan survives with the conditions
//      it was computed on, and a race of the same team in a new lobby (slots 18/19), sent live to the bridge's UDP port
//      without its end, shows `Plan: E2E plan` in the top bar's basis segment at its first frame with the team known
//      (the team's last saved plan on the track, C62d). The race is sent live, not replayed: a replay commits no
//      race-start plan, it runs on its decisions sidecar (C38, C76; `feed-pipeline.ts` `#raceStart`).
// Speed budget (spec §4.5): each wait at most 15 s, the whole spec at most 60 s; a miss is profiled and fixed, never met
// by raising a timeout.
import { createSocket } from 'node:dgram';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeSynthetic, type SyntheticSession } from '../../../test-support/recordings/index.ts';
import { freePort, importRecording, launchPitwall, startBridgeNoSession } from './harness.ts';
import { makeDataDir, openWorkbook, panelOf, removeDataDir, subscribeLines } from './support.ts';

const WAIT_MS = 15_000;
const SPEC_MS = 60_000;
const POLL_MS = 100;
/** A day as the kit writes it (`formatDay`): `27 Oct`. */
const DAY = /\d{1,2} [A-Z][a-z]{2}/;

const TEAM = 0;
const TRACK = 15;
const WEEKEND = 4242;
const NEW_LOBBY = 4343;
/** 20 slots: team 0 in `ours` (#64 first, then #2), the others two by two in other teams. */
const carsWith = (ours: readonly [number, number]): SyntheticSession['cars'] =>
  Array.from({ length: 20 }, (_, i) =>
    i === ours[0] ? { teamId: TEAM, raceNumber: 64 } : i === ours[1] ? { teamId: TEAM, raceNumber: 2 } : { teamId: 1 + (Math.floor(i / 2) % 9), raceNumber: 10 + i },
  );
const PRACTICE: SyntheticSession = { sessionUid: 0xe2e0001n, weekendId: WEEKEND, trackId: TRACK, kind: 'practice', player: 0, cars: carsWith([0, 1]) };
const QUALIFYING: SyntheticSession = {
  sessionUid: 0xe2e0002n,
  weekendId: WEEKEND,
  trackId: TRACK,
  kind: 'qualifying',
  player: 0,
  cars: carsWith([0, 1]),
  raceSamples: [
    { offsetMin: 0, weather: 1, rainPct: 12 },
    { offsetMin: 15, weather: 1, rainPct: 12 },
    { offsetMin: 30, weather: 3, rainPct: 45 },
  ],
};
const RACE: SyntheticSession = { sessionUid: 0xe2e0003n, weekendId: NEW_LOBBY, trackId: TRACK, kind: 'race', player: 18, cars: carsWith([18, 19]) };
const keyOf = (s: SyntheticSession): string => `${s.sessionUid.toString()}@${s.weekendId}`;

const cleanups: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.().catch(() => undefined);
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Message = { type: string; id?: string; value?: unknown; ok?: boolean; message?: string; feeds?: Array<{ feedId: string; kind: string }> };

/** A WebSocket client of the bridge: its first `udp` feed, subscriptions and uiActions. */
async function client(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: Message[] = [];
  socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data)) as Message));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`no WebSocket on ${port}`)), { once: true });
  });
  const until = async <T>(what: string, find: () => T | undefined): Promise<T> => {
    for (const deadline = Date.now() + WAIT_MS; Date.now() < deadline; await sleep(POLL_MS)) {
      const found = find();
      if (found !== undefined) return found;
    }
    throw new Error(`${what} within ${WAIT_MS} ms`);
  };
  const feedId = await until('a udp feed in the hello', () => messages.find((m) => m.type === 'hello')?.feeds?.find((f) => f.kind === 'udp')?.feedId);
  let ids = 0;
  return {
    feedId,
    /** Subscribes `topic` of the feed; the values it got so far. */
    subscribe(topic: string): () => unknown[] {
      const id = `s${ids++}`;
      socket.send(JSON.stringify({ type: 'subscribe', id, topic, params: {}, feedId }));
      return () => messages.filter((m) => m.id === id && (m.type === 'snapshot' || m.type === 'update')).map((m) => m.value);
    },
    /** Sends a uiAction and resolves with its answer. */
    async send(action: Record<string, unknown>): Promise<Message> {
      const id = `a${ids++}`;
      socket.send(JSON.stringify({ type: 'uiAction', id, action }));
      return until(`an answer to ${String(action['kind'])}`, () => messages.find((m) => m.type === 'actionResult' && m.id === id));
    },
    close: () => socket.close(),
  };
}

/**
 * The datagrams of a `.pwrec.gz` in order (the `.pwrec` v1 layout, `pitwall-recorder/FORMAT.md`: magic 5, version 1,
 * metadata length u32 LE and the metadata; then records of kind u8, time f64 LE, payload length u16 LE, payload; kind 0
 * a datagram). Read here because the UI's specs may not import the bridge or the engine (depcruise).
 */
function datagramsOf(file: string): Uint8Array[] {
  const bytes = gunzipSync(readFileSync(file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Uint8Array[] = [];
  for (let at = 10 + view.getUint32(6, true); at + 11 <= bytes.length; ) {
    const kind = view.getUint8(at);
    const end = at + 11 + view.getUint16(at + 9, true);
    if (kind === 0) out.push(bytes.subarray(at + 11, end));
    at = end;
  }
  return out;
}

/** Sends a recording's datagrams to the bridge's UDP port, live, without the last one (its SEND): the session keeps running. */
async function sendLive(udpPort: number, file: string): Promise<void> {
  const socket = createSocket('udp4');
  try {
    for (const bytes of datagramsOf(file).slice(0, -1)) {
      await new Promise<void>((resolve, reject) => socket.send(bytes, udpPort, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
      await sleep(1);
    }
  } finally {
    socket.close();
  }
}

/** The plan board of link group 1 (`player`): the `plan` workbook's first board (`plan-board-1`). */
const playerBoard = (page: Page) => panelOf(page, 'plan-board').first();

test('case B: plan a race out of session in the panel, save it, and a race start after a restart preselects it', async () => {
  test.setTimeout(SPEC_MS);
  const dataDir = await makeDataDir();
  cleanups.push(() => removeDataDir(dataDir));
  const sources = await mkdtemp(path.join(tmpdir(), 'pitwall-e2e-synthetic-'));
  cleanups.push(() => rm(sources, { recursive: true, force: true }));

  // 1. The practice and the qualifying imported; a bridge with no session; the panel open: no session.info.
  const practiceFile = path.join(sources, 'e2e-practice.pwrec.gz');
  const qualifyingFile = path.join(sources, 'e2e-qualifying.pwrec.gz');
  await writeSynthetic(practiceFile, PRACTICE);
  await writeSynthetic(qualifyingFile, QUALIFYING);
  await importRecording({ recording: practiceFile, dataDir });
  await importRecording({ recording: qualifyingFile, dataDir });
  const wsPort = await freePort();
  const udpPort = await freePort();
  const bridge = await startBridgeNoSession({ dataDir, wsPort, udpPort });
  cleanups.push(() => bridge.stop());
  const app = await launchPitwall({ wsPort, dataDir });
  cleanups.push(() => app.close());
  const page = await app.window('main');
  await page.bringToFront();

  const ws = await client(wsPort);
  cleanups.push(async () => ws.close());
  expect(ws.feedId).toBe(`udp-${udpPort}`);
  const info = ws.subscribe('session.info');
  await sleep(500);
  expect(info().filter((v) => v !== undefined && v !== null), 'no session.info without a session').toEqual([]);

  // 2. `Plan…` in the top bar opens the picker: the qualifying with its team's cars, preselected with the practice.
  const planning = page.getByTestId('segment-planning');
  await expect(planning).toHaveText('Plan…', { timeout: WAIT_MS });
  await planning.getByRole('button').click();
  const picker = page.getByTestId('basis-picker');
  await expect(picker).toBeVisible({ timeout: WAIT_MS });
  const qualifying = picker.getByTestId(`qualifying-${keyOf(QUALIFYING)}#${TEAM}`);
  await expect(qualifying).toBeChecked({ timeout: WAIT_MS });
  await expect(qualifying.locator('xpath=..')).toHaveText(new RegExp(`^${DAY.source} · Mercedes #64 #2`));
  await expect(picker.getByTestId(`practice-${keyOf(PRACTICE)}`)).toBeChecked();
  await picker.getByTestId('basis-confirm').click();
  await expect(picker).toBeHidden({ timeout: WAIT_MS });
  await expect(planning).toContainText('Planning', { timeout: WAIT_MS });

  // 3. The `plan` workbook: the player's board ranks #64's plans (slot 0); 5 race laps; the imported rain.
  await openWorkbook(page, 'plan');
  const board = playerBoard(page);
  const laps = board.getByTestId('laps');
  await expect(laps).toBeVisible({ timeout: WAIT_MS });
  await laps.fill('5');
  await laps.press('Enter');
  await expect(laps).toHaveValue('5', { timeout: WAIT_MS });
  await expect(board.getByTestId('computing')).toBeHidden({ timeout: WAIT_MS });
  await expect(board.locator('[data-testid^="dp-"]').first()).toBeVisible({ timeout: WAIT_MS });
  const previews = subscribeLines(bridge.log()).filter((l) => l.topic === 'plans.preview');
  expect(previews.map((l) => l.params), 'the player board reads #64 (slot 0)').toContainEqual({ carId: 0 });
  await expect(board.getByTestId('rain')).toContainText('45%', { timeout: WAIT_MS });
  await expect(board.getByTestId('conditions-source')).toHaveText(new RegExp(`^imported · Q ${DAY.source}$`));

  // 4. +30 to rain 80, committed: the round computes again (its mark appears and goes) and the conditions read edited.
  await board.getByTestId('rain').click();
  await expect(board.getByTestId('conditions')).toBeVisible({ timeout: WAIT_MS });
  await expect(board.getByTestId('cond-2-at')).toContainText('+30');
  await page.evaluate(() => {
    const w = window as unknown as { computingSeen: boolean };
    w.computingSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="computing"]') !== null) w.computingSeen = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  const rain = board.getByTestId('cond-2-rain');
  await rain.fill('80');
  await rain.press('Enter');
  await page.waitForFunction(() => (window as unknown as { computingSeen: boolean }).computingSeen, undefined, { timeout: WAIT_MS });
  await expect(board.getByTestId('computing')).toBeHidden({ timeout: WAIT_MS });
  await expect(board.getByTestId('conditions-source')).toHaveText('edited', { timeout: WAIT_MS });
  await board.getByTestId('cond-done').click();
  await expect(board.getByTestId('rain')).toContainText('80%', { timeout: WAIT_MS });

  // 5. The plan saved as `E2E plan`.
  expect(await ws.send({ kind: 'plans.save', feedId: ws.feedId, name: 'E2E plan' })).toMatchObject({ ok: true });
  ws.close();

  // 6. A restart: the saved plan survives with its conditions; a race of the team in a new lobby preselects it.
  await bridge.restart();
  const plansDir = path.join(dataDir, 'plans', String(TEAM));
  const saved = readdirSync(plansDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(plansDir, f), 'utf8')) as { name: string; trackId: number; computedOn: { forecast: Array<{ offsetMs: number; rainPct: number }> } });
  const plan = saved.find((p) => p.name === 'E2E plan');
  expect(plan?.trackId).toBe(TRACK);
  expect(plan?.computedOn.forecast.map((s) => [s.offsetMs, s.rainPct])).toEqual([
    [0, 12],
    [900_000, 12],
    [1_800_000, 80],
  ]);
  const raceFile = path.join(sources, 'e2e-race.pwrec.gz');
  await writeSynthetic(raceFile, RACE);
  await sendLive(udpPort, raceFile);
  await expect(page.getByTestId('segment-basis')).toContainText('Plan: E2E plan', { timeout: WAIT_MS });
});
