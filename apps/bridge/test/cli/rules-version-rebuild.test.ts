// The rules version rebuilds stale sessions (Task 28; C24, C38, C61). `pitwall live`, `import` and `reprocess` compute
// the rules version once, when they open the database. A session is stale when its rules version differs or its log is
// not complete. Nothing is rebuilt at bridge start (SP4.3e Task 7d: `no-startup-rebuild.test.ts`; the rebuild service,
// `test/storage/rebuild-*.test.ts`, holds the startup rebuild's ported tests); a stale session is rebuilt when first
// read (a running session's stale basis sessions: `test/pipeline/basis-replay.test.ts`). A session whose recording
// no longer yields it is kept, never served, and warned about once. `pitwall replay` and `pitwall dev` open no
// database. Every data dir and database here is a temp one (C84).
import { copyFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeedId, SessionUid } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { cliLogger } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { rebuildDatabase, sessionRebuilder } from '../../src/cli/rebuild-database.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { rulesVersion } from '../../src/storage/rules-version.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { ArraySource } from '../helpers/array-source.ts';
import { SEGMENT, startCli } from '../helpers/cli.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** The rules version an earlier bridge stored its sessions with. */
const OLD = 'rules-of-an-earlier-bridge';
const F = 'rules' as FeedId;
const silent = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-rules-'));
const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);

/** The rules version this bridge computes (C61). */
let current: string;
beforeAll(async () => {
  current = await rulesVersion(REPO);
});

/** A session the bridge stored: its key and its recording. */
type StoredSession = { key: SessionKey; file: string };

/** A session's datagrams; `ended` (default): it ends with the game's session end (SEND), as a session that ran to its end. */
const packets = (uid: bigint, weekend: number, ended = true) => {
  const run = new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session({ weekendLinkIdentifier: weekend }).participants().frames(10, () => {}).event(FTLP).frames(10, () => {});
  return (ended ? run.event({ code: 'SEND' }) : run).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
};

type LiveRun = {
  uid: number;
  weekend: number;
  at: number;
  version: string;
  /** False: the recording holds no session end (SEND), as when the bridge was stopped mid-session. */
  ended?: boolean;
};

/** A live session stored into `dir`'s database and recorded into its recordings, as the live bridge does. */
async function storeSession(dir: string, run: LiveRun): Promise<StoredSession> {
  const dirs = dataDir({ PITWALL_DATA_DIR: dir });
  const db = openDatabase(dirs.dbPath);
  try {
    const before = new Set(readdirSync(dirs.recordings));
    const pipeline = new FeedPipeline({
      feedId: F, source: new ArraySource(F, packets(BigInt(run.uid), run.weekend, run.ended ?? true)), hub: new TopicHub({ now: () => 0 }),
      features: FEATURES, log: silent, wallClock: () => run.at,
      storage: { db, recordingsDir: dirs.recordings, rulesVersion: run.version },
    });
    pipeline.start();
    await pipeline.done;
    const file = readdirSync(dirs.recordings).find((name) => name.endsWith('.pwrec.gz') && !before.has(name));
    return { key: { sessionUid: String(run.uid) as SessionUid, weekendId: String(run.weekend), playerCar: 0 as SessionKey['playerCar'] }, file: join(dirs.recordings, file!) };
  } finally {
    db.close();
  }
}

const dbOf = (dir: string): Db => openDatabase(dataDir({ PITWALL_DATA_DIR: dir }).dbPath);

/** Runs `fn` on `dir`'s database and closes it. */
async function withDb<T>(dir: string, fn: (db: Db) => T | Promise<T>): Promise<T> {
  const db = dbOf(dir);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

type Row = { session_uid: string; weekend_id: string; rules_version: string; complete: number; pwrec_path: string | null };
const rowOf = (dir: string, key: SessionKey): Promise<Row | undefined> =>
  withDb(dir, (db) => db.prepare('SELECT session_uid, weekend_id, rules_version, complete, pwrec_path FROM sessions WHERE session_uid = ? AND weekend_id = ? AND player_car = ?')
    .get(key.sessionUid, key.weekendId, key.playerCar) as Row | undefined);

/** The session's fact rows as stored, rowid included: a rebuild replaces them, so equal rowids mean nothing was rebuilt. */
const factsOf = (dir: string, key: SessionKey): Promise<unknown[]> =>
  withDb(dir, (db) => db.prepare('SELECT rowid, list, seq, car_id, record FROM facts WHERE session_uid = ? AND weekend_id = ? AND player_car = ? ORDER BY rowid')
    .all(key.sessionUid, key.weekendId, key.playerCar));

/** The session's log as stored, without rowids: a rebuild from the same recording gives the same log (C38). */
const logOf = (dir: string, key: SessionKey): Promise<unknown[]> =>
  withDb(dir, (db) => db.prepare('SELECT list, seq, car_id, record FROM facts WHERE session_uid = ? AND weekend_id = ? AND player_car = ? ORDER BY list, seq')
    .all(key.sessionUid, key.weekendId, key.playerCar));

/** Everything stored, rowids included. */
const dump = (dir: string) => withDb(dir, (db) => Object.fromEntries(['weekends', 'sessions', 'cars', 'facts'].map((t) => [t, db.prepare(`SELECT rowid, * FROM ${t} ORDER BY rowid`).all()])));

/** One line the command wrote, in the order written, with its stream. */
type Line = { stream: 'out' | 'err'; line: string };

function memoryIo(env: Record<string, string> = {}, signal = new AbortController().signal) {
  const lines: Line[] = [];
  const io: CliIo = { out: (line) => lines.push({ stream: 'out', line }), err: (line) => lines.push({ stream: 'err', line }), env, signal };
  return { io, lines };
}

/** `pitwall live` on `dir` until it listens, then stopped; every line it wrote, in order. */
async function startLive(dir: string): Promise<Line[]> {
  const abort = new AbortController();
  const { io, lines } = memoryIo({ PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: dir }, abort.signal);
  let exited = false;
  const exit = main(['live'], io).finally(() => { exited = true; });
  const t0 = Date.now();
  while (!lines.some((l) => l.stream === 'out' && l.line.startsWith('listening'))) {
    if (exited || Date.now() - t0 > 30_000) throw new Error(`live did not listen: ${lines.map((l) => l.line).join('\n')}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  abort.abort();
  expect(await exit).toBe(0);
  return lines;
}

const repoOf = (db: Db, opts: ConstructorParameters<typeof WeekendRepository>[1] = {}) => new WeekendRepository(db, { rulesVersion: current, ...opts });

// C61 "with progress shown": a schema change's rebuild reports `onProgress(done, total)` (done = recordings finished)
// for the startup server to send; it knows nothing of the server. (The rebuild service's progress:
// `test/storage/rebuild-service.test.ts`.)
describe('the schema rebuild reports its progress (C61)', { timeout: 60_000 }, () => {
  it('rebuildDatabase (a schema change) reports 0 of n before the first recording, then each recording finished', async () => {
    const dir = tmp();
    const dirs = dataDir({ PITWALL_DATA_DIR: dir });
    copyFileSync(SEGMENT, join(dirs.recordings, basename(SEGMENT)));
    const { io } = memoryIo({ PITWALL_DATA_DIR: dir });
    const calls: Array<[number, number]> = [];
    const rebuilt = await rebuildDatabase(dirs, io, current, (done: number, total: number) => calls.push([done, total]));
    rebuilt?.db.close();
    expect(rebuilt?.recordings).toBe(1);
    expect(calls).toEqual([[0, 1], [1, 1]]);
  });
});

describe('stale sessions are rebuilt when first read (C61)',{ timeout: 60_000 }, () => {
  const config = () => loadFeatureConfig(tmp(), FEATURES);

  it('a stale session of another weekend is rebuilt when first read', async () => {
    const dir = tmp();
    const earlier = await storeSession(dir, { uid: 11, weekend: 1, at: T0, version: OLD });
    await storeSession(dir, { uid: 21, weekend: 2, at: T0 + 24 * HOUR, version: current });
    const log = await logOf(dir, earlier.key);
    await startLive(dir);
    expect(await rowOf(dir, earlier.key)).toMatchObject({ rules_version: OLD });
    const { io } = memoryIo();
    const projection = await withDb(dir, (db) => repoOf(db, { log: silent, rebuild: sessionRebuilder(db, config(), io, current) }).projectionOf(earlier.key));
    expect(projection?.events.length).toBeGreaterThan(0);
    expect(await rowOf(dir, earlier.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect(await logOf(dir, earlier.key)).toEqual(log);
  });

  it('a rebuild whose recording no longer yields the session keeps the stored row and log, never serves it, and warns once (C24)', async () => {
    const dir = tmp();
    const stale = await storeSession(dir, { uid: 21, weekend: 2, at: T0, version: OLD });
    // its recording is replaced by one of another session (uid 99), recorded elsewhere
    const other = await storeSession(tmp(), { uid: 99, weekend: 2, at: T0, version: OLD });
    copyFileSync(other.file, stale.file);
    const facts = await factsOf(dir, stale.key);
    const { io, lines } = memoryIo();
    await withDb(dir, async (db) => {
      const repo = repoOf(db, { log: cliLogger(io, 'warn'), rebuild: sessionRebuilder(db, config(), io, current) });
      expect(await repo.projectionOf(stale.key)).toBeUndefined();
      expect(await repo.projectionOf(stale.key)).toBeUndefined();
    });
    expect(lines.filter((l) => l.stream === 'err' && l.line.includes(`"sessionUid":"${stale.key.sessionUid}"`))).toHaveLength(1);
    expect(await rowOf(dir, stale.key)).toMatchObject({ rules_version: OLD, complete: 1, pwrec_path: stale.file });
    expect(await factsOf(dir, stale.key)).toEqual(facts);
  });
});

describe('pitwall replay and pitwall dev open no database, so they never rebuild (C61)', { timeout: 60_000 }, () => {
  it.each([
    ['replay', [SEGMENT]],
    ['dev', ['--replay', SEGMENT]],
  ])('pitwall %s leaves a stale database as it is, and creates none where there is none', async (command, args) => {
    const dir = tmp();
    await storeSession(dir, { uid: 21, weekend: 2, at: T0, version: OLD });
    const before = await dump(dir);
    const stale = startCli([command, ...args], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: dir });
    await stale.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/, 30_000);
    expect(await stale.stop()).toBe(0);
    expect(stale.stderr()).not.toMatch(/rebuilding \d+\/\d+: /);
    expect(await dump(dir)).toEqual(before);
    const empty = tmp();
    const fresh = startCli([command, ...args], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: empty });
    await fresh.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/, 30_000);
    expect(await fresh.stop()).toBe(0);
    expect(existsSync(dataDir({ PITWALL_DATA_DIR: empty }).dbPath)).toBe(false);
  });
});

describe('pitwall import and reprocess store under the computed rules version (C61)', { timeout: 60_000 }, () => {
  it('an imported recording\'s session, and every session a reprocess writes, carry the rules version the bridge computes', async () => {
    const dir = tmp();
    const elsewhere = await storeSession(tmp(), { uid: 31, weekend: 3, at: T0, version: OLD });
    const imported = memoryIo({ PITWALL_DATA_DIR: dir });
    expect(await main(['import', elsewhere.file], imported.io)).toBe(0);
    expect(await rowOf(dir, elsewhere.key)).toMatchObject({ rules_version: current, complete: 1 });
    const live = await storeSession(dir, { uid: 32, weekend: 3, at: T0 + HOUR, version: OLD });
    const weekend = memoryIo({ PITWALL_DATA_DIR: dir });
    expect(await main(['reprocess', '--weekend', '3'], weekend.io)).toBe(0);
    expect(await rowOf(dir, live.key)).toMatchObject({ rules_version: current, complete: 1 });
    await withDb(dir, (db) => db.prepare("UPDATE sessions SET rules_version = ?").run(OLD));
    const all = memoryIo({ PITWALL_DATA_DIR: dir });
    expect(await main(['reprocess'], all.io)).toBe(0);
    expect(await rowOf(dir, elsewhere.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect(await rowOf(dir, live.key)).toMatchObject({ rules_version: current, complete: 1 });
  });
});
