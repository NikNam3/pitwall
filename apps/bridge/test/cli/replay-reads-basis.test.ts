// `pitwall replay` reads the basis from storage (SP4.3e Task 7f, ruling R21; C38, C58, C61, C62): a replay opens the
// data dir's database (`PITWALL_DATA_DIR`) to read the sessions its basis sidecar names, so its `view.basis` holds their
// projections as the live run's did (replay = live, C38); it stores nothing of the replayed session itself. A data dir
// without a database replays as before: the basis empty, no throw, no database made.
//
// Setup (builder sessions only, C84; a temporary data dir): a seat's practice and qualifying of one weekend are stored by
// live pipelines, and a live race of that weekend preselects both and writes its session file with its basis sidecar
// (`./../pipeline/basis-support.ts`). The data dir's database gets the same two sessions, current under this bridge's
// rules version (C61), so no rebuild is needed. The replay command runs in process with a probe feature added to the
// feature index, which keeps `view.basis` of every frame; `basis.active` is read over the WebSocket.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@pitwall/contracts';
import { run as replayCommand } from '../../src/cli/commands/replay.ts';
import * as features from '../../src/features/index.generated.ts';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../src/storage/rules-version.ts';
import { A, AT, basisPerFrame, basisSidecarOf, bridge, builder, last, RACE_UID, SESSION_TYPE, storeSession, type BasisActive, type Seen } from '../pipeline/basis-support.ts';

// The feature index with a probe of `view.basis` added (the replay command runs `FEATURES`).
vi.mock('../../src/features/index.generated.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof features>();
  const { basisProbe } = await import('../pipeline/basis-support.ts');
  const probe = basisProbe();
  return { ...mod, FEATURES: [...mod.FEATURES, probe.feature], probeSeen: probe.seen };
});
const seen = (features as unknown as { probeSeen: Seen[] }).probeSeen;

const WEEKEND = 71;
const PRACTICE_UID = 81n;
const QUALIFYING_UID = 82n;

const cleanup: Array<() => unknown> = [];
beforeEach(() => {
  seen.length = 0;
});
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/** Stores the seat's practice and qualifying of `WEEKEND` in `db`; their refs. */
async function storeBasis(db: Db) {
  const practice = await storeSession(db, { uid: PRACTICE_UID, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
  const qualifying = await storeSession(db, { uid: QUALIFYING_UID, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
  return { practice, qualifying };
}

/** A live race of `WEEKEND` that preselects the stored practice and qualifying: its session file, with its basis sidecar. */
async function raceRecording() {
  const b = bridge();
  const { practice, qualifying } = await storeBasis(b.db);
  const a = b.feed(A);
  a.push(builder({ uid: RACE_UID, weekend: WEEKEND, type: SESSION_TYPE.race, player: 0 }).frames(30, () => {}).packets());
  const file = await a.end();
  const basis = { practice: [practice], qualifying };
  // the setup: the live run started on both and its sidecar names them
  expect(basisSidecarOf(file)).toEqual({ start: basis, preselected: basis });
  expect(last(a.seen).sessions).toEqual([`${PRACTICE_UID}/0`, `${QUALIFYING_UID}/0`]);
  return { file, basis, live: a.seen };
}

/** A data dir whose database holds the seat's practice and qualifying, current under this bridge's rules version. */
async function dataDirWithBasis(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'replay-basis-'));
  const db = openDatabase(join(dir, 'pitwall.db'));
  await storeBasis(db);
  db.prepare('UPDATE sessions SET rules_version = ?').run(await rulesVersion(SOURCE_ROOT));
  db.close();
  return dir;
}

const sessionRows = (dir: string): unknown[] => {
  const db = openDatabase(join(dir, 'pitwall.db'));
  try {
    return db.prepare('SELECT * FROM sessions ORDER BY session_uid, weekend_id, player_car').all();
  } finally {
    db.close();
  }
};

/** Runs `pitwall replay <file>` in process on `dataDir` to its end; `basis.active` of its feed then; stops it. */
async function replayToEnd(file: string, dataDir: string): Promise<{ active: BasisActive | undefined; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  const abort = new AbortController();
  const done = replayCommand([file], {}, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: { PITWALL_DATA_DIR: dataDir, PITWALL_WS_PORT: '0' },
    signal: abort.signal,
  });
  let stopped = false;
  const stop = async (): Promise<number> => {
    if (!stopped) abort.abort();
    stopped = true;
    return done;
  };
  cleanup.push(stop);
  await vi.waitFor(() => expect(err.join('\n')).toContain('pitwall: replay finished'), { timeout: 30_000 });
  const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))?.[1];
  expect(port, `listening line in ${out.join('\n')}`).toBeDefined();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  const hello = await vi.waitFor(() => {
    const message = got.find((m) => m.type === 'hello');
    if (message === undefined) throw new Error('no hello');
    return message as Extract<ServerMessage, { type: 'hello' }>;
  });
  const feedId = hello.feeds[0]?.feedId;
  ws.send(JSON.stringify({ type: 'subscribe', id: 'basis', topic: 'basis.active', params: {}, feedId }));
  const active = await vi.waitFor(() => {
    const message = got.find((m) => (m.type === 'snapshot' || m.type === 'update') && 'id' in m && m.id === 'basis');
    if (message === undefined) throw new Error('no basis.active');
    return (message as { value?: BasisActive }).value;
  });
  ws.terminate();
  return { active, code: await stop() };
}

describe('pitwall replay reads the basis from storage (R21; C38, C61, C62)', { timeout: 120_000 }, () => {
  it('(a) a replay of a race whose basis sidecar names a stored practice and qualifying: basis.active names both, view.basis holds their projections, and nothing of the replayed session is stored', async () => {
    const { file, basis, live } = await raceRecording();
    const dataDir = await dataDirWithBasis();
    const rowsBefore = sessionRows(dataDir);
    expect(rowsBefore).toHaveLength(2);

    const { active, code } = await replayToEnd(file, dataDir);

    expect(active?.basis).toEqual(basis);
    expect(active?.start).toEqual(basis);
    // view.basis: the projections of both named sessions, at every frame as in the live run (C38)
    expect(last(seen).basis).toEqual(basis);
    expect(last(seen).sessions).toEqual([`${PRACTICE_UID}/0`, `${QUALIFYING_UID}/0`]);
    expect(basisPerFrame(seen)).toEqual(basisPerFrame(live));
    expect(code).toBe(0);
    // the replayed session is not stored: the database's session rows are those of before
    expect(sessionRows(dataDir)).toEqual(rowsBefore);
  });

  it('(b) a replay on a data dir without a database: the basis empty, no throw, and no database made', async () => {
    const { file } = await raceRecording();
    const dataDir = mkdtempSync(join(tmpdir(), 'replay-no-db-'));

    const { code } = await replayToEnd(file, dataDir);

    expect(code).toBe(0);
    expect(seen.length, 'the probe ran').toBeGreaterThan(0);
    for (const s of seen) expect(s.sessions ?? []).toEqual([]);
    expect(existsSync(join(dataDir, 'pitwall.db'))).toBe(false);
  });
});
