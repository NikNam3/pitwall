// The rules version rebuilds stale sessions (Task 28; C24, C38, C61). `pitwall live`, `import` and `reprocess` compute
// the rules version once, when they open the database. A session is stale when its rules version differs or its log is
// not complete. At bridge start, before input opens, every stale session of the newest stored session's weekend is
// rebuilt from its recording, one progress line each; any other stale session is rebuilt when first read; the sessions
// a session start's weekend context skips are rebuilt in the background. A session whose recording is missing, or whose
// recording no longer yields it, is kept, never served, and warned about once. `pitwall replay` and `pitwall dev` open
// no database. Every data dir and database here is a temp one (C84).
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeedId, SessionUid } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { cliLogger } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { sessionRebuilder } from '../../src/cli/rebuild-database.ts';
import { loadFeatureConfig, sessionConfigPath } from '../../src/feature-config.ts';
import { defineFeature } from '../../src/features/feature.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db, type SessionKey, type StoredSessionRow } from '../../src/storage/db.ts';
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

const packets = (uid: bigint, weekend: number) =>
  new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session({ weekendLinkIdentifier: weekend }).participants().frames(10, () => {}).event(FTLP).frames(10, () => {})
    .packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

type LiveRun = {
  uid: number;
  weekend: number;
  at: number;
  version: string;
  features?: typeof FEATURES;
  /** The live bridge's background rebuild, on the pipeline's database; every rebuild it starts is awaited before the database closes. */
  rebuild?: (db: Db) => (row: StoredSessionRow) => Promise<void>;
};

/** A live session stored into `dir`'s database and recorded into its recordings, as the live bridge does. */
async function storeSession(dir: string, run: LiveRun): Promise<StoredSession> {
  const dirs = dataDir({ PITWALL_DATA_DIR: dir });
  const db = openDatabase(dirs.dbPath);
  try {
    const before = new Set(readdirSync(dirs.recordings));
    const started: Array<Promise<void>> = [];
    const rebuilder = run.rebuild?.(db);
    const rebuild = rebuilder && ((row: StoredSessionRow) => { const p = rebuilder(row); started.push(p); return p; });
    const pipeline = new FeedPipeline({
      feedId: F, source: new ArraySource(F, packets(BigInt(run.uid), run.weekend)), hub: new TopicHub({ now: () => 0 }),
      features: run.features ?? FEATURES, log: silent, wallClock: () => run.at,
      storage: { db, recordingsDir: dirs.recordings, rulesVersion: run.version, ...(rebuild && { rebuild }) },
    });
    pipeline.start();
    await pipeline.done;
    await Promise.all(started);
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

const PROGRESS = /rebuilding (\d+)\/(\d+): (.+)$/;
const progressOf = (lines: readonly Line[]) => lines.filter((l) => l.stream === 'err' && PROGRESS.test(l.line));
const listeningAt = (lines: readonly Line[]) => lines.findIndex((l) => l.stream === 'out' && l.line.startsWith('listening'));

/** The lines other than progress lines that name the session: its recording's file or its session uid. */
const linesAbout = (lines: readonly Line[], session: { key: SessionKey; file: string }) =>
  lines.filter((l) => l.stream === 'err' && !PROGRESS.test(l.line)
    && (l.line.includes(basename(session.file)) || l.line.includes(`"sessionUid":"${session.key.sessionUid}"`)));

const repoOf = (db: Db, opts: ConstructorParameters<typeof WeekendRepository>[1] = {}) => new WeekendRepository(db, { rulesVersion: current, ...opts });

describe('pitwall live: the stale sessions of the newest weekend are rebuilt at start (C61)', { timeout: 60_000 }, () => {
  it('a changed rules version rebuilds the current weekend at start and logs progress, before input opens', async () => {
    const dir = tmp();
    const earlier = await storeSession(dir, { uid: 11, weekend: 1, at: T0, version: OLD });
    const practice = await storeSession(dir, { uid: 21, weekend: 2, at: T0 + 24 * HOUR, version: OLD });
    const qualifying = await storeSession(dir, { uid: 22, weekend: 2, at: T0 + 25 * HOUR, version: OLD });
    const logs = { practice: await logOf(dir, practice.key), qualifying: await logOf(dir, qualifying.key) };
    const lines = await startLive(dir);
    const progress = progressOf(lines);
    expect(progress.map((l) => l.line.match(PROGRESS)!.slice(1, 3).join('/'))).toEqual(['1/2', '2/2']);
    expect(progress.map((l) => [basename(practice.file), basename(qualifying.file)].filter((name) => l.line.includes(name)))).toEqual(
      expect.arrayContaining([[basename(practice.file)], [basename(qualifying.file)]]),
    );
    for (const line of progress) expect(lines.indexOf(line)).toBeLessThan(listeningAt(lines));
    expect(await rowOf(dir, practice.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect(await rowOf(dir, qualifying.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect(await logOf(dir, practice.key)).toEqual(logs.practice);
    expect(await logOf(dir, qualifying.key)).toEqual(logs.qualifying);
    // another weekend's stale session waits for its first read
    expect(await rowOf(dir, earlier.key)).toMatchObject({ rules_version: OLD });
  });

  it('an incomplete session of the newest weekend is rebuilt at start', async () => {
    const dir = tmp();
    const session = await storeSession(dir, { uid: 21, weekend: 2, at: T0, version: current });
    const complete = await withDb(dir, (db) => repoOf(db).projectionOf(session.key));
    expect(complete?.events.length).toBeGreaterThan(0);
    // as if the bridge was killed mid-session: part of the log written, never marked complete
    await withDb(dir, (db) => {
      db.prepare('UPDATE sessions SET complete = 0').run();
      db.prepare("DELETE FROM facts WHERE list = 'events' OR list LIKE 'spans:%'").run();
    });
    const lines = await startLive(dir);
    expect(progressOf(lines).map((l) => l.line.includes(basename(session.file)))).toEqual([true]);
    expect(await rowOf(dir, session.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect(await withDb(dir, (db) => repoOf(db).projectionOf(session.key))).toEqual(complete);
  });

  it('an unchanged rules version rebuilds nothing', async () => {
    const dir = tmp();
    await storeSession(dir, { uid: 11, weekend: 1, at: T0, version: current });
    await storeSession(dir, { uid: 21, weekend: 2, at: T0 + 24 * HOUR, version: current });
    const before = await dump(dir);
    const lines = await startLive(dir);
    expect(progressOf(lines)).toEqual([]);
    expect(await dump(dir)).toEqual(before);
  });

  it('a session whose recording is missing is kept and not served, and warned about once', async () => {
    const dir = tmp();
    const gone = await storeSession(dir, { uid: 21, weekend: 2, at: T0, version: OLD });
    await storeSession(dir, { uid: 22, weekend: 2, at: T0 + HOUR, version: current });
    rmSync(gone.file);
    rmSync(sessionConfigPath(gone.file), { force: true });
    const facts = await factsOf(dir, gone.key);
    const lines = await startLive(dir);
    expect(linesAbout(lines, gone)).toHaveLength(1);
    expect(await rowOf(dir, gone.key)).toMatchObject({ rules_version: OLD, complete: 1, pwrec_path: gone.file });
    expect(await factsOf(dir, gone.key)).toEqual(facts);
    const rebuild = vi.fn(async () => {});
    expect(await withDb(dir, (db) => repoOf(db, { rebuild }).projectionOf(gone.key))).toBeUndefined();
    expect(rebuild).not.toHaveBeenCalled();
  });
});

describe('stale sessions outside the start-up rebuild (C61)', { timeout: 60_000 }, () => {
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

  it('a session skipped by weekendContext is rebuilt in the background; the running session keeps its context', async () => {
    const dir = tmp();
    const practice = await storeSession(dir, { uid: 20, weekend: 2, at: T0, version: OLD });
    const qualifying = await storeSession(dir, { uid: 21, weekend: 2, at: T0 + HOUR, version: OLD });
    const logs = [await logOf(dir, practice.key), await logOf(dir, qualifying.key)];
    const seen: unknown[] = [];
    const probe: QuickCalculator<number> = { kind: 'quick', id: 'probe.weekend', reads: ['session'], cadence: 'frame',
      compute: ({ weekend }) => { seen.push(weekend === undefined ? undefined : structuredClone(weekend)); return seen.length; }, insights: () => [] };
    const { io, lines } = memoryIo();
    const asked: string[] = [];
    await storeSession(dir, {
      uid: 22, weekend: 2, at: T0 + 2 * HOUR, version: current,
      features: [...FEATURES, defineFeature({ name: 'probe-weekend', calculators: [probe], topics: [] })],
      rebuild: (db) => { const rebuilder = sessionRebuilder(db, config(), io, current); return (row) => { asked.push(row.sessionUid); return rebuilder(row); }; },
    });
    expect(asked.sort()).toEqual(['20', '21']);
    // the running session started without them: its weekend context holds no stale session
    expect(seen.at(-1)).toEqual({ weekendId: '2', player: { teamId: 0, raceNumber: 1 }, sessions: [] });
    expect(await rowOf(dir, practice.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect(await rowOf(dir, qualifying.key)).toMatchObject({ rules_version: current, complete: 1 });
    expect([await logOf(dir, practice.key), await logOf(dir, qualifying.key)]).toEqual(logs);
    // each background rebuild is logged
    for (const stored of [practice, qualifying]) expect(lines.filter((l) => l.stream === 'err' && l.line.includes(basename(stored.file)))).not.toEqual([]);
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
