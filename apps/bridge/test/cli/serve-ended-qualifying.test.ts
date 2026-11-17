// SP4.3d2 Task 5 (C38, C59 as changed, C61, C62; SP4.3d spec §7.0 rules 1 and 4, plan call 1): the ended qualifying run
// survives a restart. The planning base is the ended run's view, kept in memory; a bridge restarted in the gap between
// qualifying and the race replays the recording to get the same run back.
//
// Seams this file assumes (the implement phase adds them):
//  - `LiveFeed.port` (serve's live feeds carry their UDP port; `pitwall live` passes it) and `FeedPipelineOptions.listenPort`:
//    a live session's recording has the feed's UDP port as its meta `listenPort` (today always 0);
//  - `serve`, live, before input opens: per feed, the newest stored session whose recording's meta `listenPort` is the
//    feed's port (or 0 when the bridge runs one feed); when `endsQualifying` of its weekend phase and its recording holds
//    SEND, `FeedPipeline.restoreEnded(row)`: the recording replayed with its sidecars, finished and stored if incomplete,
//    the run kept as the feed's ended session (its topics answer as after a live end; `feed.status.betweenSessions`).
//
// Every earlier run is a live run of a committed segment (C84) in temporary data dirs; `serve` runs on the same database
// and recordings dir, with manual sources and a WebSocket client.
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeedStatus, ServerMessage, SessionInfo, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { decode, PacketId, peekHeader } from '@pitwall/protocol';
import { main } from '../../src/cli/pitwall.ts';
import type * as ProcessRecordingModule from '../../src/cli/process-recording.ts';
import { processRecording } from '../../src/cli/process-recording.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { rulesVersion } from '../../src/storage/rules-version.ts';
import { sessionRebuilder } from '../../src/cli/rebuild-database.ts';
import { serve } from '../../src/cli/serve.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import type { Feature } from '../../src/features/feature.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { readPwrec, readPwrecMeta } from '../../src/pwrec/reader.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { WsClient } from '../../src/ws/client.ts';
import { segmentPath } from '../fixtures/replay.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { factRows } from '../storage/records.ts';

// `processRecording` (what the startup rebuild runs for each stale recording) is observed; it is the real one.
vi.mock('../../src/cli/process-recording.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessRecordingModule>();
  return { ...actual, processRecording: vi.fn(actual.processRecording) };
});
const processed = vi.mocked(processRecording);

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** The rules version the earlier runs stored with; `pitwall live` computes its own (C61), so these sessions are stale there. */
const RULES = 'unversioned';
const PORT_A = 20_777;
const PORT_B = 20_778;
const A = `udp-${PORT_A}` as FeedId;
const B = `udp-${PORT_B}` as FeedId;
const W0 = Date.UTC(2026, 10, 17, 12, 0, 0);
const HOUR_MS = 3_600_000;
const GRACE_MS = 10_000;
const TICK_MS = 5;
/** The serving process's monotonic clock starts elsewhere than the earlier runs'. */
const SERVE_ORIGIN_MS = 7_000_000;
/** The topics of the ended session compared across the restart (job topics excepted, C38). */
const TOPICS: readonly TopicName[] = [
  'session.info', 'laps', 'stints', 'events', 'cars.overview',
  'situation.weekendPhase', 'situation.sessionPhaseQualifying', 'situation.carLocation',
];
/** Header (29 bytes) plus the Session body's offset of `sessionType` (weather, two temperatures, laps, track length). */
const SESSION_TYPE_OFFSET = 29 + 6;
const tmp = () => mkdtempSync(join(tmpdir(), 'serve-ended-qualifying-'));

const isSessionPacket = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.session && header.sessionUid !== 0n;
};
const isSend = (p: PreparedPacket): boolean => {
  const decoded = decode(p.bytes);
  return decoded.ok && decoded.packet.packetId === PacketId.event && decoded.packet.details.code === 'SEND';
};
const sessionTypeOf = (p: PreparedPacket): number | undefined => {
  const decoded = decode(p.bytes);
  return decoded.ok && decoded.packet.packetId === PacketId.session ? decoded.packet.sessionType : undefined;
};
const uidOf = (packets: readonly PreparedPacket[]): string => String(peekHeader(packets.find(isSessionPacket)!.bytes)!.sessionUid);

async function packetsOf(file: string): Promise<PreparedPacket[]> {
  const packets: PreparedPacket[] = [];
  for await (const r of readPwrec(segmentPath(file))) packets.push({ bytes: r.payload, receivedAtMs: r.t });
  return packets;
}

/** `packets` with every Session packet's session type set to `type` (a Q1 or a Q3 made from a committed segment). */
const withSessionType = (packets: readonly PreparedPacket[], type: number): PreparedPacket[] =>
  packets.map((p) => {
    if (sessionTypeOf(p) === undefined) return p;
    const bytes = Uint8Array.from(p.bytes);
    bytes[SESSION_TYPE_OFFSET] = type;
    return { ...p, bytes };
  });

const shifted = (packets: readonly PreparedPacket[], firstAtMs: number): PreparedPacket[] =>
  packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - packets[0]!.receivedAtMs + firstAtMs }));

type Place = { dbPath: string; db: Db; recordingsDir: string };
const newPlace = (): Place => {
  const dir = tmp();
  const recordingsDir = join(dir, 'recordings');
  mkdirSync(recordingsDir);
  const dbPath = join(dir, 'live.db');
  return { dbPath, db: openDatabase(dbPath), recordingsDir };
};

type SessionRowSql = { session_uid: string; weekend_id: string; player_car: number; pwrec_path: string | null; complete: number };
const rowOf = (db: Db, sessionUid: string): SessionRowSql => {
  const row = db.prepare('SELECT session_uid, weekend_id, player_car, pwrec_path, complete FROM sessions WHERE session_uid = ?').get(sessionUid) as SessionRowSql | undefined;
  if (row === undefined) throw new Error(`no stored session ${sessionUid}`);
  return row;
};
const keyOfRow = (row: SessionRowSql): SessionKey => ({ sessionUid: row.session_uid, weekendId: row.weekend_id, playerCar: row.player_car } as SessionKey);
const factsOf = (db: Db, sessionUid: string) => factRows(db, keyOfRow(rowOf(db, sessionUid)));
const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name)).sort();

/** What a subscriber holds of each topic: a state topic's newest value, an append topic's entries. */
type Held = Map<string, unknown>;
const json = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function hold(held: Held, id: string, m: ServerMessage): void {
  if (!('id' in m) || m.id !== id) return;
  if (m.type === 'snapshot' && 'entries' in m && m.entries !== undefined) held.set(id, json(m.entries));
  else if (m.type === 'append') held.set(id, [...((held.get(id) as unknown[] | undefined) ?? []), ...(json(m.entries) as unknown[])]);
  else if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) held.set(id, json(m.value));
}

/**
 * An earlier bridge run of `packets` on the live pipeline, its recording's meta `listenPort` the feed's port
 * (`listenPort`; unset: an older recording's `0`). `endByTimer`: the session ends by Task 3's timer (stored complete), and
 * the topics a late subscriber then gets are returned; else the bridge is stopped with the session stored incomplete.
 */
async function earlierRun(packets: readonly PreparedPacket[], place: Place, opts: { wallMs: number; listenPort?: number; endByTimer?: boolean; features?: readonly Feature[] }) {
  const before = new Set(recordingsOf(place.recordingsDir));
  const feed = opts.listenPort === undefined ? ('earlier' as FeedId) : (`udp-${opts.listenPort}` as FeedId);
  const source = new ManualSource(feed);
  let now = 0;
  let t = 0;
  let pipeline: FeedPipeline | undefined = undefined;
  const hub = new TopicHub({ now: () => (t += 1000), onDemandChange: (changed) => { if (changed === feed) pipeline?.demandChanged(); } });
  pipeline = new FeedPipeline({
    feedId: feed, source, hub, features: opts.features ?? [], log: createLogger({ level: 'silent' }), wallClock: () => opts.wallMs,
    storage: { db: place.db, rulesVersion: RULES, recordingsDir: place.recordingsDir },
    staleCheck: { clock: () => now, everyMs: TICK_MS },
    ...(opts.listenPort !== undefined && { listenPort: opts.listenPort }),
  });
  pipeline.start();
  for (const p of packets) {
    now = p.receivedAtMs;
    source.push(p.bytes, p.receivedAtMs);
  }
  const uid = uidOf(packets);
  const held: Held = new Map();
  if (opts.endByTimer) {
    const send = packets.find(isSend)!;
    now = send.receivedAtMs + GRACE_MS + 1000;
    await vi.waitFor(() => expect(rowOf(place.db, uid).complete).toBe(1), { timeout: 10_000 });
    // a late subscriber of the ended session
    hub.addClient('late', { send: (m) => { for (const topic of TOPICS) hold(held, topic, m); }, bufferedAmount: () => 0 });
    for (const topic of TOPICS) hub.subscribe({ clientId: 'late', id: topic, topic, params: {}, feedId: feed });
    hub.tick();
  }
  await pipeline.stop();
  const made = recordingsOf(place.recordingsDir).filter((file) => !before.has(file));
  expect(made).toHaveLength(1);
  expect(rowOf(place.db, uid)).toMatchObject({ complete: opts.endByTimer ? 1 : 0, pwrec_path: made[0] });
  return { file: made[0]!, uid, held };
}

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/** A live `serve` with one manual source per feed (`ports`), storing in `place` (its own connection; `serve` closes it). */
async function liveServe(place: Place, ports: readonly number[]) {
  const sources = new Map(ports.map((port) => [port, new ManualSource(`udp-${port}` as FeedId)] as const));
  const out: string[] = [];
  const abort = new AbortController();
  const io = { out: (line: string) => out.push(line), err: () => {}, env: {}, signal: abort.signal };
  const db = openDatabase(place.dbPath);
  const done = serve({
    sources: ports.map((port) => ({ source: sources.get(port)!, port, feed: { kind: 'udp', label: `UDP port ${port}` } as const })),
    wsPort: 0,
    dumpsDir: join(tmp(), 'dumps'),
    storage: { db, recordingsDir: place.recordingsDir, rulesVersion: RULES, rebuild: sessionRebuilder(db, effectiveConfig(FEATURES), io, RULES) },
    staleCheck: { clock: () => SERVE_ORIGIN_MS, everyMs: 500 },
    io,
  });
  const clients: WsClient[] = [];
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    for (const client of clients) client.close();
    abort.abort();
    await done;
  };
  cleanup.push(stop);
  await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 60_000 });
  const wsPort = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
  const ws = WsClient.connect(`ws://127.0.0.1:${wsPort}`, { reconnectMs: 50 });
  clients.push(ws);
  /** Subscribes `topics` of `feed`: what the client holds of each, and whether each said `noData`. */
  const watch = (feed: FeedId, topics: readonly TopicName[]) => {
    const held: Held = new Map();
    const noData = new Set<string>();
    for (const topic of topics) {
      ws.subscribe(topic, {}, (m) => {
        if (m.type === 'topicStatus' && m.status === 'noData') noData.add(topic);
        hold(held, topic, { ...m, id: topic } as ServerMessage);
      }, feed);
    }
    return { held, noData };
  };
  const push = (port: number, packets: readonly PreparedPacket[]): void => {
    for (const p of packets) sources.get(port)!.push(p.bytes, p.receivedAtMs);
  };
  return { watch, push, stop };
}

/** The feed's `session.info` once the server answers it: the restored session's, or `undefined` (noData). */
async function sessionInfoOf(watching: { held: Held; noData: Set<string> }): Promise<SessionInfo | undefined> {
  await vi.waitFor(() => expect(watching.held.has('session.info') || watching.noData.has('session.info')).toBe(true), { timeout: 30_000 });
  return watching.held.get('session.info') as SessionInfo | undefined;
}

/** Lets the work already due run. */
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let texas: PreparedPacket[];
let texasQ1: PreparedPacket[];
let singaporeQ3: PreparedPacket[];
beforeAll(async () => {
  let singaporeQ2: PreparedPacket[];
  [texas, singaporeQ2] = await Promise.all([packetsOf('qualifying-texas-send.pwrec.gz'), packetsOf('qualifying-singapore-end.pwrec.gz')]);
  // one-shot qualifying (type 9): it ends qualifying; the tail after SEND is shorter than the grace window
  expect(sessionTypeOf(texas.find(isSessionPacket)!)).toBe(9);
  const send = texas.find(isSend);
  expect(send).toBeDefined();
  expect(texas.at(-1)!.receivedAtMs - send!.receivedAtMs).toBeLessThan(GRACE_MS);
  // the same session as a Q1 (type 5, segment 1): it does not end qualifying
  texasQ1 = withSessionType(texas, 5);
  expect(texasQ1.filter(isSessionPacket).every((p) => sessionTypeOf(p) === 5)).toBe(true);
  // Singapore's Q2 end as a Q3 (type 7): it ends qualifying, and holds SEND
  expect(sessionTypeOf(singaporeQ2.find(isSessionPacket)!)).toBe(6);
  singaporeQ3 = withSessionType(singaporeQ2, 7);
  expect(singaporeQ3.some(isSend)).toBe(true);
  expect(uidOf(singaporeQ3)).not.toBe(uidOf(texas));
});

describe('the ended qualifying run survives a restart (C59, C38; spec §7.0 rule 4)', { timeout: 300_000 }, () => {
  it('a live qualifying ended by the timer, the bridge restarted: session.info and the ended session\'s topics equal those before', async () => {
    const place = newPlace();
    const first = await earlierRun(texas, place, { wallMs: W0, listenPort: PORT_A, endByTimer: true, features: FEATURES });
    expect((first.held.get('session.info') as SessionInfo | undefined)?.sessionUid).toBe(first.uid);
    const factsBefore = factsOf(place.db, first.uid);

    const live = await liveServe(place, [PORT_A]);
    const watching = live.watch(A, [...TOPICS, 'feed.status']);
    expect((await sessionInfoOf(watching))?.sessionUid).toBe(first.uid);
    for (const topic of TOPICS) await vi.waitFor(() => expect(watching.held.has(topic)).toBe(true), { timeout: 30_000 });
    await settle();
    for (const topic of TOPICS) expect({ topic, value: watching.held.get(topic) }).toEqual({ topic, value: first.held.get(topic) });
    await vi.waitFor(() => expect(watching.held.get('feed.status') as FeedStatus | undefined).toMatchObject({ feedId: A, betweenSessions: true, stale: false }));
    await live.stop();
    // the stored session stays as it was (C24): complete, its log unchanged
    expect(rowOf(place.db, first.uid).complete).toBe(1);
    expect(factsOf(place.db, first.uid)).toEqual(factsBefore);
  });

  it('an incomplete stored qualifying whose recording holds SEND: complete after startup, its log equal to a reprocess\'s', async () => {
    const place = newPlace();
    const { file, uid } = await earlierRun(texas, place, { wallMs: W0, listenPort: PORT_A });
    const live = await liveServe(place, [PORT_A]);
    // before input opens (C61): complete once the bridge listens
    expect(rowOf(place.db, uid).complete).toBe(1);
    const watching = live.watch(A, ['session.info']);
    expect((await sessionInfoOf(watching))?.sessionUid).toBe(uid);
    await live.stop();
    const stored = factsOf(place.db, uid);
    const reference = openDatabase(join(tmp(), 'reference.db'));
    await processRecording(file, reference, createLogger({ level: 'silent' }), new AbortController().signal, effectiveConfig(FEATURES), RULES);
    const replayed = factsOf(reference, uid);
    expect(replayed.length).toBeGreaterThan(0);
    expect(stored).toEqual(replayed);
  });

  it('a qualifying without SEND: not restored at startup', async () => {
    const place = newPlace();
    const beforeSend = texas.slice(0, texas.findIndex(isSend));
    expect(beforeSend.some(isSend)).toBe(false);
    const { uid } = await earlierRun(beforeSend, place, { wallMs: W0, listenPort: PORT_A });
    const live = await liveServe(place, [PORT_A]);
    expect(await sessionInfoOf(live.watch(A, ['session.info']))).toBeUndefined();
    await settle();
    expect(rowOf(place.db, uid).complete).toBe(0);
    await live.stop();
  });

  it('a Q1 (segment 1): not restored', async () => {
    const place = newPlace();
    const { uid } = await earlierRun(texasQ1, place, { wallMs: W0, listenPort: PORT_A });
    const live = await liveServe(place, [PORT_A]);
    expect(await sessionInfoOf(live.watch(A, ['session.info']))).toBeUndefined();
    await settle();
    expect(rowOf(place.db, uid).complete).toBe(0);
    await live.stop();
  });

  it('a live recording\'s meta holds the feed\'s port', async () => {
    const place = newPlace();
    const live = await liveServe(place, [PORT_A]);
    live.push(PORT_A, shifted(texas.slice(0, texas.findIndex(isSend)), SERVE_ORIGIN_MS));
    await vi.waitFor(() => expect(recordingsOf(place.recordingsDir)).toHaveLength(1), { timeout: 30_000 });
    await live.stop();
    const [file] = recordingsOf(place.recordingsDir);
    expect(readPwrecMeta(file!).listenPort).toBe(PORT_A);
  });

  it('the newest session of another port is not this feed\'s', async () => {
    const place = newPlace();
    const own = await earlierRun(texas, place, { wallMs: W0, listenPort: PORT_A });
    // newer, and an ended qualifying too, but recorded on the other port
    const other = await earlierRun(singaporeQ3, place, { wallMs: W0 + HOUR_MS, listenPort: PORT_B });
    const live = await liveServe(place, [PORT_A]);
    expect((await sessionInfoOf(live.watch(A, ['session.info'])))?.sessionUid).toBe(own.uid);
    await settle();
    expect(rowOf(place.db, own.uid).complete).toBe(1);
    expect(rowOf(place.db, other.uid).complete).toBe(0);
    await live.stop();
  });

  it('a listenPort 0 recording is restored with one feed', async () => {
    const place = newPlace();
    const { file, uid } = await earlierRun(texas, place, { wallMs: W0 });
    expect(readPwrecMeta(file).listenPort).toBe(0);
    const live = await liveServe(place, [PORT_A]);
    expect(rowOf(place.db, uid).complete).toBe(1);
    expect((await sessionInfoOf(live.watch(A, ['session.info'])))?.sessionUid).toBe(uid);
    await live.stop();
  });

  it('a listenPort 0 recording with two feeds is not restored', async () => {
    const place = newPlace();
    const { file, uid } = await earlierRun(texas, place, { wallMs: W0 });
    expect(readPwrecMeta(file).listenPort).toBe(0);
    const live = await liveServe(place, [PORT_A, PORT_B]);
    expect(await sessionInfoOf(live.watch(A, ['session.info']))).toBeUndefined();
    expect(await sessionInfoOf(live.watch(B, ['session.info']))).toBeUndefined();
    await settle();
    expect(rowOf(place.db, uid).complete).toBe(0);
    await live.stop();
  });
});

// SP4.3d2 Task 5 fix round (ruling R21, the double replay; C61): `pitwall live` picks each feed's restore rows before its
// startup rebuild and leaves them out of it; `restoreEnded` replaces a stale row (incomplete, or of another rules
// version), so an ended qualifying is replayed once at startup and stored under the current rules version.
describe('pitwall live replays a stale ended qualifying once at startup (C61, C59)', { timeout: 300_000 }, () => {
  /** A data dir as `pitwall live` reads it, its database open for the earlier runs. */
  const livePlace = (): Place & { dir: string } => {
    const dir = tmp();
    const dirs = dataDir({ PITWALL_DATA_DIR: dir });
    return { dir, dbPath: dirs.dbPath, db: openDatabase(dirs.dbPath), recordingsDir: dirs.recordings };
  };

  /** `pitwall live` on `dir` (one feed) until it listens, then stopped; the lines it wrote to stderr, in order. */
  async function startLive(dir: string): Promise<string[]> {
    const abort = new AbortController();
    const err: string[] = [];
    const out: string[] = [];
    const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line), env: { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: dir }, signal: abort.signal };
    const exit = main(['live'], io);
    await vi.waitFor(() => expect(out.some((line) => line.startsWith('listening'))).toBe(true), { timeout: 120_000, interval: 50 });
    abort.abort();
    expect(await exit).toBe(0);
    return err;
  }

  let current: string;
  beforeAll(async () => {
    current = await rulesVersion(REPO);
    expect(current).not.toBe(RULES);
  });

  it.each([
    ['stored complete under an older rules version', true],
    ['stored incomplete under an older rules version', false],
  ])('an ended qualifying %s: replayed once (restored, not rebuilt), stored complete under the current rules version', async (_name, endByTimer) => {
    const place = livePlace();
    const { file, uid } = await earlierRun(texas, place, { wallMs: W0, endByTimer });
    processed.mockClear();
    const err = await startLive(place.dir);
    // the startup rebuild did not replay it ...
    expect(processed.mock.calls.map(([path]) => path)).not.toContain(file);
    expect(err.filter((line) => /rebuilding \d+\/\d+: /.test(line) && line.includes(file))).toEqual([]);
    // ... the restore did, once
    expect(err.filter((line) => /restoring \d+\/\d+: /.test(line) && line.includes(file))).toHaveLength(1);
    // stored as a rebuild under the current rules writes it
    const row = place.db.prepare('SELECT rules_version, complete FROM sessions WHERE session_uid = ?').get(uid);
    expect(row).toEqual({ rules_version: current, complete: 1 });
    const reference = openDatabase(join(tmp(), 'reference.db'));
    await processRecording(file, reference, createLogger({ level: 'silent' }), new AbortController().signal, effectiveConfig(FEATURES), current);
    const replayed = factsOf(reference, uid);
    expect(replayed.length).toBeGreaterThan(0);
    expect(factsOf(place.db, uid)).toEqual(replayed);
  });
});
