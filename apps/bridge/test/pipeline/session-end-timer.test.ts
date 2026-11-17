// SP4.3d2 Task 3 (C3, C37, C38, C52, C59, C61, C73; SP4.3d spec §3.3, §7.0 rules 1–3): a session ends by timer when its
// SEND grace window (10 s) has passed, whether or not another packet arrives; between sessions the feed is not stale;
// a plan between sessions is not taken.
//
// Seams this file assumes (the implement phase adds them):
//  - `SessionTracker.expire(receivedAtMs)` (packages/engine), called by the live pipeline's stale timer (`staleCheck`) at
//    `clock()` before it checks the feed: the SEND frame applied, `runner.finish`, the session stored complete, its
//    recording closed with its end record;
//  - `feed.status.betweenSessions`: true from a session's end until the next session's first packet; then `stale` is
//    false and no `feed.stale` insight is raised.
//
// Every run is a live run of committed segments (C84) in temporary data dirs; the stale timer runs on a test clock.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeedStatus, ServerMessage, TopicName } from '@pitwall/contracts';
import { carId, type FeedId } from '@pitwall/domain';
import { decode, PacketId, peekHeader } from '@pitwall/protocol';
import { processRecording } from '../../src/cli/process-recording.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import feedStatusFeature from '../../src/features/feed-status/register.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import insightsFeature from '../../src/features/insights/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import type { PlanDecision } from '../../src/pipeline/team-feeds.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { rawRecords } from '../pwrec/helpers.ts';
import { factRows } from '../storage/records.ts';

const F = 'live' as FeedId;
const RULES = 'unversioned';
const W0 = Date.UTC(2026, 10, 16, 12, 0, 0);
const GRACE_MS = 10_000;
const TICK_MS = 5;
const tmp = () => mkdtempSync(join(tmpdir(), 'session-end-timer-'));

const isSession = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.session && header.sessionUid !== 0n;
};
const isSend = (p: PreparedPacket): boolean => {
  const decoded = decode(p.bytes);
  return decoded.ok && decoded.packet.packetId === PacketId.event && decoded.packet.details.code === 'SEND';
};

async function packetsOf(file: string): Promise<PreparedPacket[]> {
  const packets: PreparedPacket[] = [];
  for await (const r of readPwrec(segmentPath(file))) packets.push({ bytes: r.payload, receivedAtMs: r.t });
  return packets;
}

/** `packets` on a receive clock whose first packet arrives at `firstAtMs`. */
const shifted = (packets: readonly PreparedPacket[], firstAtMs: number): PreparedPacket[] =>
  packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - packets[0]!.receivedAtMs + firstAtMs }));

type Insight = { kind: string };
type InsightEntry = { type: string; insight?: Insight };

/** A hub whose window keeps the last `feed.status` and every raised insight. */
function watchingHub(topics: readonly TopicName[]) {
  let nowMs = 0;
  const hub = new TopicHub({ now: () => (nowMs += 1000) });
  const values = new Map<string, unknown>();
  const raised: Insight[] = [];
  const send = (m: ServerMessage) => {
    if (!('id' in m) || typeof m.id !== 'string') return;
    if ('entries' in m && m.entries !== undefined) {
      for (const entry of m.entries as InsightEntry[]) if (m.id === 'insights' && entry.type === 'raised' && entry.insight) raised.push(entry.insight);
    } else if (m.type === 'snapshot' || m.type === 'update') values.set(m.id, m.value);
  };
  hub.addClient('window', { send, bufferedAmount: () => 0 });
  for (const topic of topics) hub.subscribe({ clientId: 'window', id: topic, topic, params: {}, feedId: F });
  return { hub, status: () => values.get('feed.status') as FeedStatus | undefined, staleRaised: () => raised.filter((i) => i.kind === 'feed.stale') };
}

type Place = { db: Db; recordingsDir: string };
const newPlace = (): Place => ({ db: openDatabase(join(tmp(), 'live.db')), recordingsDir: tmp() });

type Line = { level: number } & Record<string, unknown>;
const ERROR = 50;

/** A live pipeline on a `ManualSource` whose stale timer reads the test's receive clock (`setNow`). */
function liveRun(place: Place = newPlace()) {
  const watching = watchingHub(['insights', 'feed.status']);
  const lines: Line[] = [];
  const log = createLogger({ level: 'warn', destination: new Writable({ write(c, _e, cb) { lines.push(JSON.parse(String(c)) as Line); cb(); } }) });
  let now = 0;
  const source = new ManualSource(F);
  const pipeline = new FeedPipeline({
    feedId: F, source, hub: watching.hub, features: [insightsFeature, feedStatusFeature], log, wallClock: () => W0,
    storage: { db: place.db, rulesVersion: RULES, recordingsDir: place.recordingsDir },
    staleCheck: { clock: () => now, everyMs: TICK_MS },
  });
  pipeline.start();
  /** Packets arrive at their receive times; the test clock follows them. */
  const push = (packets: readonly PreparedPacket[]) => {
    for (const p of packets) {
      now = p.receivedAtMs;
      source.push(p.bytes, p.receivedAtMs);
    }
  };
  const setNow = (ms: number) => { now = ms; };
  const errors = () => lines.filter((l) => l.level >= ERROR);
  return { pipeline, place, push, setNow, errors, ...watching };
}

/** Lets the stale timer run a few times at the current test clock. */
const ticks = (n = 20) => new Promise<void>((resolve) => setTimeout(resolve, TICK_MS * n));

type SessionRowSql = { session_uid: string; weekend_id: string; player_car: number; complete: number };
const sessionRows = (db: Db): SessionRowSql[] =>
  db.prepare('SELECT session_uid, weekend_id, player_car, complete FROM sessions ORDER BY session_uid, weekend_id, player_car').all() as SessionRowSql[];
const keyOfRow = (row: SessionRowSql): SessionKey => ({ sessionUid: row.session_uid, weekendId: row.weekend_id, playerCar: row.player_car } as SessionKey);
const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name)).sort();
/** The recording is closed: its last record is the end record (kind 255). */
const closed = (path: string): boolean => existsSync(path) && rawRecords(path).at(-1)?.kind === 255;

let qualifyingEnd: PreparedPacket[];
let sendAt: number;
let pitExit: PreparedPacket[];
let nextSession: PreparedPacket[];
beforeAll(async () => {
  let singaporeEnd: PreparedPacket[];
  [qualifyingEnd, pitExit, singaporeEnd] = await Promise.all([
    packetsOf('qualifying-singapore-end.pwrec.gz'),
    packetsOf('race-zandvoort-pit-exit.pwrec.gz'),
    packetsOf('race-singapore-end.pwrec.gz'),
  ]);
  const send = qualifyingEnd.find(isSend);
  expect(send).toBeDefined();
  sendAt = send!.receivedAtMs;
  // the tail after SEND is shorter than the grace window: only the timer can end the session
  expect(qualifyingEnd.at(-1)!.receivedAtMs - sendAt).toBeLessThan(GRACE_MS);
  nextSession = singaporeEnd.slice(singaporeEnd.findIndex(isSession));
});

/** A live feed gets the qualifying session's end (SEND, its tail), then silence until 11 s after SEND. */
async function endedByTimer(place?: Place) {
  const run = liveRun(place);
  run.push(qualifyingEnd);
  expect(sessionRows(run.place.db).map((r) => r.complete)).toEqual([0]);
  run.setNow(sendAt + GRACE_MS + 1000);
  const [file] = recordingsOf(run.place.recordingsDir);
  expect(file).toBeDefined();
  await vi.waitFor(() => expect(sessionRows(run.place.db).map((r) => r.complete)).toEqual([1]), { timeout: 5000 });
  await vi.waitFor(() => expect(closed(file!)).toBe(true), { timeout: 5000 });
  return { ...run, file: file! };
}

describe('a session ends by timer (C59, C38; spec §7.0 rule 1)', { timeout: 120_000 }, () => {
  it('live end by timer', async () => {
    const run = await endedByTimer();
    // the end record is written once
    expect(rawRecords(run.file).filter((r) => r.kind === 255)).toHaveLength(1);
    // closing spans are stored (`runner.finish` ran)
    expect(factRows(run.place.db, keyOfRow(sessionRows(run.place.db)[0]!)).some((row) => row.list.startsWith('spans'))).toBe(true);
    await run.pipeline.stop();
    expect(run.errors()).toEqual([]);
  });

  it('reprocess = live', async () => {
    const run = await endedByTimer();
    const live = factRows(run.place.db, keyOfRow(sessionRows(run.place.db)[0]!));
    await run.pipeline.stop();
    const reference = openDatabase(join(tmp(), 'reference.db'));
    await processRecording(run.file, reference, createLogger({ level: 'silent' }), new AbortController().signal, effectiveConfig(FEATURES), RULES);
    const replayed = factRows(reference, keyOfRow(sessionRows(reference)[0]!));
    expect(replayed.length).toBeGreaterThan(0);
    expect(live).toEqual(replayed);
    expect(run.errors()).toEqual([]);
  });
});

describe('between sessions the feed is not stale (C52; spec §7.0 rule 2)', { timeout: 120_000 }, () => {
  it('between sessions', async () => {
    const run = await endedByTimer();
    await vi.waitFor(() => expect(run.status()).toMatchObject({ feedId: F, betweenSessions: true, stale: false }));
    // five minutes of silence: still between sessions, never stale
    run.setNow(sendAt + 300_000);
    await ticks();
    expect(run.status()).toMatchObject({ betweenSessions: true, stale: false });
    expect(run.staleRaised()).toEqual([]);
    // the next session's first packet ends the gap
    const next = shifted(nextSession, sendAt + 300_001);
    run.push(next.slice(0, 1));
    expect(run.status()).toMatchObject({ betweenSessions: false, stale: false });
    await run.pipeline.stop();
    expect(run.errors()).toEqual([]);
  });

  it('silence in a session', async () => {
    const run = liveRun();
    const first = pitExit.slice(0, Math.floor(pitExit.length / 2));
    expect(first.some(isSend)).toBe(false);
    run.push(first);
    run.setNow(first.at(-1)!.receivedAtMs + 3000);
    await vi.waitFor(() => expect(run.staleRaised()).toHaveLength(1));
    expect(run.status()).toMatchObject({ betweenSessions: false, stale: true });
    await run.pipeline.stop();
    expect(run.errors()).toEqual([]);
  });
});

describe('a plan between sessions is not taken (C73; spec §7.0 rule 3)', { timeout: 120_000 }, () => {
  it('plan in the gap', async () => {
    const run = await endedByTimer();
    const player = carId(peekHeader(qualifyingEnd[0]!.bytes)!.playerCarIndex);
    const plan: PlanDecision = { kind: 'planCommitted', carId: player, policy: { stops: [{ lap: 30, compound: 'hard' }] } };
    expect(run.pipeline.commitPlan(plan)).toMatchObject({ ok: false, reason: 'notSupported' });
    await run.pipeline.stop();
    // no sidecar holds the plan
    const sidecars = readdirSync(run.place.recordingsDir).filter((name) => name.endsWith('.json'));
    for (const name of sidecars) expect(readFileSync(join(run.place.recordingsDir, name), 'utf8')).not.toContain('planCommitted');
    expect(run.errors()).toEqual([]);
  });
});
