// SP4.3c Task 10b, fix round (C59, C1a): the sweep of stale stored sessions never completes a session a feed of this
// run will still continue or is continuing.
//  (a) A live session that continues nothing sweeps the other stored incomplete sessions only once every configured feed
//      of the run has received its first Session packet (no clock, no timeout): a feed that has not connected yet may
//      still continue its stored session (Task 10). A feed that never connects leaves its stale sessions incomplete.
//  (b) A session is swept only if no feed runs or restores it, checked when its queued rebuild actually starts
//      (`StaleSessions.rebuild` runs one recording at a time): a restore that begins while the rebuild waits wins.
//
// Each test runs a live `serve` over temporary data dirs (C84) on the live bridge's rebuild (`sessionRebuilder`), the
// stored sessions made by earlier stopped runs of committed segments. The rebuild replays in a worker thread (SP4.3e
// Task 7d), so the test observes it on the main thread: the rebuilds `serve` hands to the live bridge's rebuild (its
// `storage.rebuild`, wrapped by the test, and in (b) held), their `pitwall: rebuilding` lines, and the stored rows
// (rules version, `complete`). The rebuild itself is the real one.
//
// SP4.3e Task 7d fix round, F4: ported from a main-thread `vi.mock` of `processRecording`, which the worker never sees.
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { PacketId, peekHeader } from '@pitwall/protocol';
import { sessionRebuilder } from '../../src/cli/rebuild-database.ts';
import { serve } from '../../src/cli/serve.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase, type Db, type SessionKey, type StoredSessionRow } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { factRows } from '../storage/records.ts';

/** The recordings whose rebuild `serve` started (handed to the live bridge's rebuild), in call order. */
let rebuilt: string[] = [];
const processedPaths = (): string[] => rebuilt;
/** When set, the next rebuild `serve` starts waits for it before it runs (the hold of test b). */
let holdNext: Promise<void> | undefined;
/** The recordings named by the `pitwall: rebuilding <file> (a stale stored session)` lines. */
const rebuildingLines = (err: readonly string[]): string[] =>
  err.flatMap((line) => /^pitwall: rebuilding (.+) \(a stale stored session\)$/.exec(line)?.[1] ?? []);

const RULES = 'unversioned';
const A = 'udp-20777' as FeedId;
const B = 'udp-20778' as FeedId;
const W0 = Date.UTC(2026, 10, 15, 12, 0, 0);
/** The serving process's monotonic clock starts elsewhere than the earlier runs'. */
const SERVE_ORIGIN_MS = 7_000_000;
const tmp = () => mkdtempSync(join(tmpdir(), 'serve-stale-sweep-'));

const isSession = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.session && header.sessionUid !== 0n;
};

async function packetsOf(file: string): Promise<PreparedPacket[]> {
  const packets: PreparedPacket[] = [];
  for await (const r of readPwrec(segmentPath(file))) packets.push({ bytes: r.payload, receivedAtMs: r.t });
  return packets;
}

const shifted = (packets: readonly PreparedPacket[], firstAtMs: number): PreparedPacket[] =>
  packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - packets[0]!.receivedAtMs + firstAtMs }));

/** A segment split at its first Session packet past the middle: `first` before it, `rest` from it. */
const splitAtSession = (packets: PreparedPacket[]): { first: PreparedPacket[]; rest: PreparedPacket[] } => {
  const at = packets.findIndex((p, i) => i >= Math.floor(packets.length / 2) && isSession(p));
  expect(at).toBeGreaterThan(0);
  return { first: packets.slice(0, at), rest: packets.slice(at) };
};

const uidOf = (packets: readonly PreparedPacket[]): string => String(peekHeader(packets.find(isSession)!.bytes)!.sessionUid);

type Place = { dbPath: string; db: Db; recordingsDir: string };
const newPlace = (): Place => {
  const dir = tmp();
  const recordingsDir = join(dir, 'recordings');
  mkdirSync(recordingsDir);
  const dbPath = join(dir, 'live.db');
  return { dbPath, db: openDatabase(dbPath), recordingsDir };
};

type SessionRowSql = { session_uid: string; weekend_id: string; player_car: number; pwrec_path: string | null; rules_version: string; complete: number };
const rowOf = (db: Db, sessionUid: string): SessionRowSql => {
  const row = db.prepare('SELECT session_uid, weekend_id, player_car, pwrec_path, rules_version, complete FROM sessions WHERE session_uid = ?').get(sessionUid) as SessionRowSql | undefined;
  if (row === undefined) throw new Error(`no stored session ${sessionUid}`);
  return row;
};
const hasRow = (db: Db, sessionUid: string): boolean => db.prepare('SELECT 1 FROM sessions WHERE session_uid = ?').get(sessionUid) !== undefined;
const keyOfRow = (row: SessionRowSql): SessionKey => ({ sessionUid: row.session_uid, weekendId: row.weekend_id, playerCar: row.player_car } as SessionKey);
const factsOf = (db: Db, sessionUid: string) => factRows(db, keyOfRow(rowOf(db, sessionUid)));
const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name)).sort();
const datagramPayloads = async (path: string): Promise<number[][]> => {
  const out: number[][] = [];
  for await (const r of readPwrec(path)) out.push([...r.payload]);
  return out;
};

/** An earlier bridge run that got `packets` and was stopped: its session stays stored incomplete with its recording (Task 10). */
async function stoppedRun(packets: readonly PreparedPacket[], place: Place, wallMs: number): Promise<string> {
  const before = new Set(recordingsOf(place.recordingsDir));
  const source = new ManualSource('earlier' as FeedId);
  let nowMs = 0;
  const pipeline = new FeedPipeline({
    feedId: source.feedId, source, hub: new TopicHub({ now: () => (nowMs += 1000) }), features: [], log: createLogger({ level: 'silent' }),
    wallClock: () => wallMs, storage: { db: place.db, rulesVersion: RULES, recordingsDir: place.recordingsDir },
  });
  pipeline.start();
  for (const p of packets) source.push(p.bytes, p.receivedAtMs);
  await pipeline.stop();
  const made = recordingsOf(place.recordingsDir).filter((file) => !before.has(file));
  expect(made).toHaveLength(1);
  expect(rowOf(place.db, uidOf(packets))).toMatchObject({ complete: 0, pwrec_path: made[0] });
  return made[0]!;
}

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
  rebuilt = [];
  holdNext = undefined;
});

/**
 * A live `serve` with one manual source per feed in `feeds`, storing in `place` (its own connection; `serve` closes it)
 * on the live bridge's rebuild. `stop()` stops it.
 */
async function liveServe(place: Place, feeds: readonly FeedId[]) {
  const sources = new Map(feeds.map((id) => [id, new ManualSource(id)] as const));
  const out: string[] = [];
  const err: string[] = [];
  const abort = new AbortController();
  const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line), env: {}, signal: abort.signal };
  const db = openDatabase(place.dbPath);
  const rebuilder = sessionRebuilder(db, effectiveConfig(FEATURES), io, RULES);
  /** The live bridge's rebuild, observed: each rebuild `serve` starts is noted, and the held one waits for its release. */
  const rebuild = async (row: StoredSessionRow): Promise<void> => {
    rebuilt.push(row.pwrecPath ?? '');
    const hold = holdNext;
    holdNext = undefined;
    if (hold !== undefined) await hold;
    return rebuilder(row);
  };
  const done = serve({
    sources: feeds.map((id) => ({ source: sources.get(id)!, feed: { kind: 'udp', label: id } as const })),
    wsPort: 0,
    dumpsDir: join(tmp(), 'dumps'),
    storage: { db, recordingsDir: place.recordingsDir, rulesVersion: RULES, rebuild },
    io,
  });
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    await done;
  };
  cleanup.push(stop);
  await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 15_000 });
  const push = (feed: FeedId, packets: readonly PreparedPacket[]): void => {
    for (const p of packets) sources.get(feed)!.push(p.bytes, p.receivedAtMs);
  };
  return { push, stop, err };
}

/** Lets the background work that is already due run (a rebuild queued now starts within it). */
const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

/** The continued session's stored state is the restore's: its own recording grown, its stored facts kept, nothing new for its key. */
async function expectContinued(place: Place, uid: string, file: string, before: { payloads: number[][]; facts: ReturnType<typeof factRows> }) {
  const row = rowOf(place.db, uid);
  expect(row.pwrec_path).toBe(file);
  expect(row.rules_version).toBe(RULES);
  // the bridge was stopped, not the session ended: it stays incomplete, for a later run to continue
  expect(row.complete).toBe(0);
  const payloads = await datagramPayloads(file);
  expect(payloads.slice(0, before.payloads.length)).toEqual(before.payloads);
  expect(payloads.length).toBeGreaterThan(before.payloads.length);
  const facts = factsOf(place.db, uid);
  for (const fact of before.facts) expect(facts).toContainEqual(fact);
  expect(facts.length).toBeGreaterThan(before.facts.length);
}

let pitExit: PreparedPacket[];
let singaporeStart: PreparedPacket[];
let driveThrough: PreparedPacket[];
beforeAll(async () => {
  [pitExit, singaporeStart, driveThrough] = await Promise.all([
    packetsOf('race-zandvoort-pit-exit.pwrec.gz'),
    packetsOf('race-singapore-start.pwrec.gz'),
    packetsOf('race-drive-through.pwrec.gz'),
  ]);
});

describe('the stale sweep spares every session a feed of the run may continue (C59, C1a)', { timeout: 300_000 }, () => {
  it('waits until every configured feed has received its first Session packet; the late feed then continues its session, the sweep does not', async () => {
    const place = newPlace();
    // B's session, stopped mid-way by an earlier bridge stop: B will continue it once its game sends again
    const b = splitAtSession(singaporeStart);
    const fileB = await stoppedRun(b.first, place, W0);
    // a session nobody continues, of another weekend
    const stale = driveThrough.slice(0, Math.floor(driveThrough.length / 2));
    const fileC = await stoppedRun(stale, place, W0 + 600_000);
    const [uidB, uidC] = [uidOf(b.first), uidOf(stale)];
    const beforeB = { payloads: await datagramPayloads(fileB), facts: factsOf(place.db, uidB) };

    const live = await liveServe(place, [A, B]);
    // feed A starts a new session that continues nothing; feed B has received nothing yet
    live.push(A, shifted(pitExit, SERVE_ORIGIN_MS));
    await vi.waitFor(() => expect(hasRow(place.db, uidOf(pitExit))).toBe(true), { timeout: 30_000 });
    await settle();
    // no sweep yet: not B's session, and not the other stale one either (the sweep waits for every feed)
    expect(processedPaths()).toEqual([]);
    expect([rowOf(place.db, uidB).complete, rowOf(place.db, uidC).complete]).toEqual([0, 0]);

    // B's game sends again: its first Session packet continues B's stored session (Task 10)
    live.push(B, shifted(b.rest, SERVE_ORIGIN_MS + 1_000));
    // now every feed has its first Session packet: the sweep completes the session nobody continues ...
    await vi.waitFor(() => expect(rowOf(place.db, uidC).complete).toBe(1), { timeout: 60_000, interval: 100 });
    expect(rowOf(place.db, uidC).pwrec_path).toBe(fileC);
    // ... and never rebuilds the one B continues
    expect(processedPaths()).toEqual([fileC]);
    await vi.waitFor(() => expect(factsOf(place.db, uidB).length).toBeGreaterThan(beforeB.facts.length), { timeout: 60_000, interval: 100 });
    await settle();
    expect(processedPaths()).toEqual([fileC]);
    expect(rebuildingLines(live.err)).toEqual([fileC]);
    expect(rowOf(place.db, uidC).rules_version).toBe(RULES);

    await live.stop();
    // B's session is the continuation's alone: its own recording grown, no second recording of its key
    await expectContinued(place, uidB, fileB, beforeB);
    expect(recordingsOf(place.recordingsDir)).toHaveLength(3);
    expect(live.err.some((line) => line.includes(fileB))).toBe(false);
  });

  it('a feed that has not received its first Session packet keeps every stale session incomplete for the run', async () => {
    const place = newPlace();
    const stale = driveThrough.slice(0, Math.floor(driveThrough.length / 2));
    await stoppedRun(stale, place, W0);
    const live = await liveServe(place, [A, B]);
    live.push(A, shifted(pitExit, SERVE_ORIGIN_MS));
    await vi.waitFor(() => expect(hasRow(place.db, uidOf(pitExit))).toBe(true), { timeout: 30_000 });
    await settle();
    await live.stop();
    expect(processedPaths()).toEqual([]);
    expect(rebuildingLines(live.err)).toEqual([]);
    expect(rowOf(place.db, uidOf(stale)).complete).toBe(0);
  });

  it('a queued rebuild re-checks when it starts: a session a feed began restoring meanwhile is skipped, its row and recording the restore\'s', async () => {
    const place = newPlace();
    // X, the older stale session: its rebuild runs first and is held by the test
    const staleX = driveThrough.slice(0, Math.floor(driveThrough.length / 2));
    const fileX = await stoppedRun(staleX, place, W0);
    // Y: stale too, queued behind X, until a feed continues it
    const y = splitAtSession(singaporeStart);
    const fileY = await stoppedRun(y.first, place, W0 + 600_000);
    const [uidX, uidY] = [uidOf(staleX), uidOf(y.first)];
    const beforeY = { payloads: await datagramPayloads(fileY), facts: factsOf(place.db, uidY) };

    let release!: () => void;
    holdNext = new Promise<void>((resolve) => { release = resolve; });

    // one feed: its new session continues nothing and every feed has its first Session packet, so the sweep queues X and Y
    const live = await liveServe(place, [A]);
    live.push(A, shifted(pitExit, SERVE_ORIGIN_MS));
    await vi.waitFor(() => expect(processedPaths()).toEqual([fileX]), { timeout: 30_000, interval: 50 });
    // while X's rebuild runs (Y's waits behind it), the feed's game switches to Y's session: a restore of Y begins
    live.push(A, shifted(y.rest, SERVE_ORIGIN_MS + pitExit.at(-1)!.receivedAtMs - pitExit[0]!.receivedAtMs + 1_000));
    release();
    await vi.waitFor(() => expect(rowOf(place.db, uidX).complete).toBe(1), { timeout: 60_000, interval: 100 });
    await settle(1_000);
    // Y's queued rebuild started after the restore had begun: skipped
    expect(processedPaths()).toEqual([fileX]);
    await vi.waitFor(() => expect(factsOf(place.db, uidY).length).toBeGreaterThan(beforeY.facts.length), { timeout: 60_000, interval: 100 });
    expect(processedPaths()).toEqual([fileX]);
    expect(rebuildingLines(live.err)).toEqual([fileX]);

    await live.stop();
    await expectContinued(place, uidY, fileY, beforeY);
    // X was rebuilt under this bridge's rules version, from its own recording
    expect(rowOf(place.db, uidX)).toMatchObject({ pwrec_path: fileX, rules_version: RULES, complete: 1 });
    expect(recordingsOf(place.recordingsDir)).toHaveLength(3);
  });
});
