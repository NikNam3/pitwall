// SP4.3e Task 7d (C61 as changed: "nothing at bridge start"; C24, C59): `pitwall live` (`serve`) opens input without
// rebuilding any stored session. A stale session (another rules version, or a log not complete) stays as it is until a
// reader needs it (the rebuild service, `test/storage/rebuild-*.test.ts`). Ported from `rules-version-rebuild.test.ts`
// (its startup rebuild is deleted with this task): a changed rules version marks the stored sessions stale.
//
// The stored sessions are made by a live pipeline over builder packets in a temporary data dir (C84).
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeedId, SessionUid } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { rulesVersion } from '../../src/storage/rules-version.ts';
import { isStale, WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { ArraySource } from '../helpers/array-source.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** The rules version an earlier bridge stored its sessions with. */
const OLD = 'rules-of-an-earlier-bridge';
const F = 'stored' as FeedId;
const silent = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-no-startup-rebuild-'));
const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);

/** The rules version this bridge computes (C61). */
let current: string;
beforeAll(async () => {
  current = await rulesVersion(REPO);
});

const packets = (uid: bigint, weekend: number) =>
  new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session({ weekendLinkIdentifier: weekend }).participants().frames(10, () => {}).event(FTLP).frames(10, () => {})
    .event({ code: 'SEND' }).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/** A live session stored into `dir`'s database under `version` and recorded into its recordings. */
async function storeSession(dir: string, run: { uid: number; weekend: number; at: number; version: string }): Promise<SessionKey> {
  const dirs = dataDir({ PITWALL_DATA_DIR: dir });
  const db = openDatabase(dirs.dbPath);
  try {
    const pipeline = new FeedPipeline({
      feedId: F, source: new ArraySource(F, packets(BigInt(run.uid), run.weekend)), hub: new TopicHub({ now: () => 0 }),
      features: FEATURES, log: silent, wallClock: () => run.at, storage: { db, recordingsDir: dirs.recordings, rulesVersion: run.version },
    });
    pipeline.start();
    await pipeline.done;
    expect(readdirSync(dirs.recordings).some((name) => name.endsWith('.pwrec.gz'))).toBe(true);
    return { sessionUid: String(run.uid) as SessionUid, weekendId: String(run.weekend), playerCar: 0 as SessionKey['playerCar'] };
  } finally {
    db.close();
  }
}

async function withDb<T>(dir: string, fn: (db: Db) => T): Promise<T> {
  const db = openDatabase(dataDir({ PITWALL_DATA_DIR: dir }).dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Everything stored, rowids included: equal dumps mean nothing was rebuilt or written. */
const dump = (dir: string) => withDb(dir, (db) => Object.fromEntries(['weekends', 'sessions', 'cars', 'facts'].map((t) => [t, db.prepare(`SELECT rowid, * FROM ${t} ORDER BY rowid`).all()])));

type Line = { stream: 'out' | 'err'; line: string };

/** `pitwall live` on `dir` until it listens, then stopped; every line it wrote, in order. */
async function startLive(dir: string): Promise<Line[]> {
  const abort = new AbortController();
  const lines: Line[] = [];
  const io: CliIo = {
    out: (line) => lines.push({ stream: 'out', line }), err: (line) => lines.push({ stream: 'err', line }),
    env: { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: dir }, signal: abort.signal,
  };
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

describe('pitwall live rebuilds nothing at start (C61)', { timeout: 60_000 }, () => {
  it('serve with a stale stored session opens input without rebuilding it (no rebuilding line, the row unchanged)', async () => {
    const dir = tmp();
    await storeSession(dir, { uid: 11, weekend: 1, at: T0, version: OLD });
    const practice = await storeSession(dir, { uid: 21, weekend: 2, at: T0 + 24 * HOUR, version: OLD });
    const qualifying = await storeSession(dir, { uid: 22, weekend: 2, at: T0 + 25 * HOUR, version: current });
    // as a bridge stopped mid-session left it: never marked complete
    await withDb(dir, (db) => db.prepare('UPDATE sessions SET complete = 0 WHERE session_uid = ?').run(qualifying.sessionUid));
    const before = await dump(dir);
    const lines = await startLive(dir);
    expect(lines.filter((l) => /rebuilding/.test(l.line))).toEqual([]);
    expect(await dump(dir)).toEqual(before);
    // both stale sessions of the newest weekend are still stale: rebuilt only when first needed
    const stale = await withDb(dir, (db) => new WeekendRepository(db, { rulesVersion: current }).staleSessionsOf('2').map((row) => row.sessionUid));
    expect(stale).toEqual([practice.sessionUid, qualifying.sessionUid]);
  });

  // Ported from the startup rebuild's "a changed rules version rebuilds the current weekend at start".
  it('a changed rules version marks sessions stale', async () => {
    const dir = tmp();
    const earlier = await storeSession(dir, { uid: 11, weekend: 1, at: T0, version: OLD });
    const fresh = await storeSession(dir, { uid: 21, weekend: 2, at: T0 + 24 * HOUR, version: current });
    await startLive(dir);
    await withDb(dir, (db) => {
      const repo = new WeekendRepository(db, { rulesVersion: current });
      expect(isStale(repo.sessionOf(earlier)!, current)).toBe(true);
      expect(isStale(repo.sessionOf(fresh)!, current)).toBe(false);
    });
  });
});
