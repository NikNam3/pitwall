// SP4.3c Task 10b (C59, C75 as changed 2026-11-15; C24, C38, C61, C73): the user may end a session's recording early, a
// stored complete session is never replaced or reopened, and sessions nobody continues are completed in the background.
//
// Seams this file assumes (the implement phase adds them):
//  - `FeedPipeline.endSession(): DecisionResult` (what `serve` hands the uiAction `session.end` to): with a running
//    session it finishes that session exactly as the input's own end does (`runner.finish`, the pending frame applied as
//    at a stream end, the closing spans stored, the row marked complete, `onStored` once, the recording closed with its
//    end record) and answers `{ ok: true }`; without a running session it answers `{ ok: false, reason: 'invalid' }`.
//    Afterwards the feed's packets of that session key are ignored (nothing recorded, stored or published of them, the
//    feed's health aside) until a Session packet of another key arrives.
//  - `feed.status` (`FeedStatus`, delegated contracts change) carries `sessionEnded: boolean`: true from an ended
//    session's end until a session of another key starts, false while a session runs.
//  - packets of a session key whose stored session is complete are ignored the same way, in the same process and after a
//    bridge restart: the recording is not resumed, the stored row and its facts are not touched.
//  - when a live feed starts a session that continues no stored incomplete session, every other stored incomplete session
//    (any weekend, any feed) goes to `storage.rebuild` in the background; the live bridge's rebuild (`sessionRebuilder`)
//    completes one whose recording is there and keeps (and logs) one whose recording is missing. A session that continues
//    a stored recording (a restart, Task 10) starts no such sweep.
//
// Every run is a live run of committed segments (C84) in temporary data dirs; receive times follow each other.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { PacketId, peekHeader } from '@pitwall/protocol';
import { processRecording } from '../../src/cli/process-recording.ts';
import { sessionRebuilder } from '../../src/cli/rebuild-database.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource } from '../../src/input/packet-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline, type DecisionResult, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase, type Db, type SessionKey, type StoredSessionRow } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { rawRecords } from '../pwrec/helpers.ts';
import { factRows } from '../storage/records.ts';

/** The seam this task adds to `FeedPipeline`; read through a cast so the file compiles before it exists. */
type EndSeam = { endSession: () => DecisionResult };
const endSession = (pipeline: FeedPipeline): DecisionResult => (pipeline as unknown as EndSeam).endSession();

const F = 'live' as FeedId;
const RULES = 'unversioned';
const tmp = () => mkdtempSync(join(tmpdir(), 'session-end-'));
const W0 = Date.UTC(2026, 10, 15, 12, 0, 0);

/** The topics a window watches: core lists, situations, session info, insights, and the feed's status. */
const WATCHED: TopicName[] = ['laps', 'events', 'stints', 'pitStops', 'insights', 'session.info', 'situation.carLocation', 'situation.sessionPhaseRace', 'situation.carActivityRace', 'feed.status'];

const isSession = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.session && header.sessionUid !== 0n;
};

async function packetsOf(file: string): Promise<PreparedPacket[]> {
  const packets: PreparedPacket[] = [];
  for await (const r of readPwrec(segmentPath(file))) packets.push({ bytes: r.payload, receivedAtMs: r.t });
  return packets;
}

/** `packets` on a receive clock whose first packet arrives at `firstAtMs`. */
const shifted = (packets: readonly PreparedPacket[], firstAtMs: number): PreparedPacket[] =>
  packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - packets[0]!.receivedAtMs + firstAtMs }));

/** A segment split at its first Session packet past the middle: `first` before it, `rest` from it. */
type Split = { first: PreparedPacket[]; rest: PreparedPacket[] };
const splitAtSession = (packets: PreparedPacket[]): Split => {
  const at = packets.findIndex((p, i) => i >= Math.floor(packets.length / 2) && isSession(p));
  expect(at).toBeGreaterThan(0);
  return { first: packets.slice(0, at), rest: packets.slice(at) };
};

/** A hub whose window keeps every message per topic, the last value of each state topic and each append topic's entries. */
function watchingHub(topics: readonly TopicName[]) {
  let nowMs = 0;
  const hub = new TopicHub({ now: () => (nowMs += 1000) });
  const messages: Array<{ id: string; type: ServerMessage['type'] }> = [];
  const values = new Map<string, unknown>();
  const send = (m: ServerMessage) => {
    if ('id' in m && typeof m.id === 'string') messages.push({ id: m.id, type: m.type });
    if (m.type === 'snapshot' && m.entries === undefined) values.set(m.id, m.value);
    else if (m.type === 'update') values.set(m.id, m.value);
  };
  hub.addClient('window', { send, bufferedAmount: () => 0 });
  for (const topic of topics) hub.subscribe({ clientId: 'window', id: topic, topic, params: {}, feedId: F });
  return { hub, messages, value: (topic: TopicName) => values.get(topic) };
}

type Place = { db: Db; recordingsDir: string };
const newPlace = (): Place => ({ db: openDatabase(join(tmp(), 'live.db')), recordingsDir: tmp() });

/** Log lines at warn and above, parsed. */
type Line = { level: number; msg?: string } & Record<string, unknown>;
const ERROR = 50;

function livePipeline(source: PacketSource, o: { place: Place; wallMs?: number; extra?: Partial<FeedPipelineOptions>; storage?: Partial<NonNullable<FeedPipelineOptions['storage']>> }) {
  const watching = watchingHub(WATCHED);
  const lines: Line[] = [];
  const log = createLogger({ level: 'warn', destination: new Writable({ write(c, _e, cb) { lines.push(JSON.parse(String(c)) as Line); cb(); } }) });
  const pipeline = new FeedPipeline({
    feedId: F, source, hub: watching.hub, features: [], log, wallClock: () => o.wallMs ?? W0,
    storage: { db: o.place.db, rulesVersion: RULES, recordingsDir: o.place.recordingsDir, ...o.storage },
    ...o.extra,
  });
  const errors = () => lines.filter((l) => l.level >= ERROR);
  return { pipeline, lines, errors, ...watching };
}

/** A run that gets `packets` and ends with its input (not stopped): the session ends as at its stream end. */
async function streamRun(packets: readonly PreparedPacket[], place: Place = newPlace(), wallMs = W0) {
  const run = livePipeline(new ArraySource(F, packets), { place, wallMs });
  run.pipeline.start();
  await run.pipeline.done;
  return { ...run, place };
}

/** A run that gets `packets` and is stopped (a bridge stop): its session stays stored incomplete (Task 10). */
async function stoppedRun(packets: readonly PreparedPacket[], place: Place, wallMs = W0) {
  const source = new ManualSource(F);
  const run = livePipeline(source, { place, wallMs });
  run.pipeline.start();
  for (const p of packets) source.push(p.bytes, p.receivedAtMs);
  await run.pipeline.stop();
  return run;
}

const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name)).sort();

type SessionRowSql = { session_uid: string; weekend_id: string; player_car: number; started_at: string; pwrec_path: string | null; rules_version: string; complete: number };
const sessionRows = (db: Db): SessionRowSql[] =>
  db.prepare('SELECT session_uid, weekend_id, player_car, started_at, pwrec_path, rules_version, complete FROM sessions ORDER BY session_uid, weekend_id, player_car').all() as SessionRowSql[];
const keyOfRow = (row: SessionRowSql): SessionKey => ({ sessionUid: row.session_uid, weekendId: row.weekend_id, playerCar: row.player_car } as SessionKey);
const rowOf = (db: Db, sessionUid: string): SessionRowSql => {
  const row = sessionRows(db).find((r) => r.session_uid === sessionUid);
  if (row === undefined) throw new Error(`no stored session ${sessionUid}`);
  return row;
};
/** Everything storage holds: every table's rows, in a fixed order. */
const everything = (db: Db) => ({
  sessions: db.prepare('SELECT * FROM sessions ORDER BY session_uid, weekend_id, player_car').all(),
  cars: db.prepare('SELECT * FROM cars ORDER BY session_uid, weekend_id, player_car, car_id').all(),
  facts: db.prepare('SELECT * FROM facts ORDER BY session_uid, weekend_id, player_car, list, seq').all(),
});
const datagramPayloads = async (path: string): Promise<number[][]> => {
  const out: number[][] = [];
  for await (const r of readPwrec(path)) out.push([...r.payload]);
  return out;
};
const uidOf = (packets: readonly PreparedPacket[]): string => String(peekHeader(packets.find(isSession)!.bytes)!.sessionUid);

/** The ended session's recording is closed: its last record is the end record (kind 255). */
const closed = (path: string): boolean => existsSync(path) && rawRecords(path).at(-1)?.kind === 255;

let pitExit: PreparedPacket[];
let singaporeEnd: PreparedPacket[];
let qualifyingEnd: PreparedPacket[];
let singaporeStart: PreparedPacket[];
let driveThrough: PreparedPacket[];
beforeAll(async () => {
  [pitExit, singaporeEnd, qualifyingEnd, singaporeStart, driveThrough] = await Promise.all([
    packetsOf('race-zandvoort-pit-exit.pwrec.gz'),
    packetsOf('race-singapore-end.pwrec.gz'),
    packetsOf('qualifying-singapore-end.pwrec.gz'),
    packetsOf('race-singapore-start.pwrec.gz'),
    packetsOf('race-drive-through.pwrec.gz'),
  ]);
});

describe('session.end: the user ends a session\'s recording early (C59, C73, C75)', { timeout: 180_000 }, () => {
  it('ends the running session as its input\'s end does: stored complete with the closing spans, recording closed with its end record', async () => {
    const { first } = splitAtSession(pitExit);
    // one run whose input ends right there: the log a run ending at that frame stores
    const whole = await streamRun(first);
    const wanted = factRows(whole.place.db, keyOfRow(sessionRows(whole.place.db)[0]!));
    expect(wanted.some((row) => row.list.startsWith('spans'))).toBe(true);

    const place = newPlace();
    const onStored = vi.fn();
    const source = new ManualSource(F);
    const run = livePipeline(source, { place, storage: { onStored } });
    run.pipeline.start();
    for (const p of first) source.push(p.bytes, p.receivedAtMs);
    expect(sessionRows(place.db).map((r) => r.complete)).toEqual([0]);
    expect(endSession(run.pipeline)).toEqual({ ok: true });

    const [file] = recordingsOf(place.recordingsDir);
    expect(file).toBeDefined();
    await vi.waitFor(() => expect(closed(file!)).toBe(true));
    // stored complete, with the log (closing spans included) of the run whose input ended there
    expect(sessionRows(place.db).map((r) => r.complete)).toEqual([1]);
    expect(factRows(place.db, keyOfRow(sessionRows(place.db)[0]!))).toEqual(wanted);
    expect(onStored).toHaveBeenCalledTimes(1);
    // the recording holds the session's datagrams as the run whose input ended there recorded them, then the end record
    expect(await datagramPayloads(file!)).toEqual(await datagramPayloads(recordingsOf(whole.place.recordingsDir)[0]!));
    expect(rawRecords(file!).filter((r) => r.kind === 255)).toHaveLength(1);
    // the feed shows the session as ended
    expect(run.value('feed.status')).toMatchObject({ feedId: F, sessionEnded: true });

    await run.pipeline.stop();
    expect(run.errors()).toEqual([]);
  });

  it('ignores the rest of the ended session: no rows, no file growth, no topic updates; a session of another key records normally', async () => {
    const { first, rest } = splitAtSession(pitExit);
    const place = newPlace();
    const source = new ManualSource(F);
    const run = livePipeline(source, { place });
    run.pipeline.start();
    for (const p of first) source.push(p.bytes, p.receivedAtMs);
    expect(endSession(run.pipeline)).toEqual({ ok: true });
    const [file] = recordingsOf(place.recordingsDir);
    await vi.waitFor(() => expect(closed(file!)).toBe(true));

    const stored = everything(place.db);
    const bytes = readFileSync(file!);
    const seenBefore = run.messages.length;
    // the rest of the same session arrives: its Session packets carry the ended session's key
    for (const p of rest) source.push(p.bytes, p.receivedAtMs);
    expect(everything(place.db)).toEqual(stored);
    expect(readFileSync(file!).equals(bytes)).toBe(true);
    expect(recordingsOf(place.recordingsDir)).toEqual([file]);
    // nothing of it is published; the feed's own health may still update, and it still shows the session ended
    expect(run.messages.slice(seenBefore).filter((m) => m.id !== 'feed.status')).toEqual([]);
    expect(run.value('feed.status')).toMatchObject({ sessionEnded: true });

    // a session of another key afterwards records as any new session: its own recording and row, its topics
    const next = shifted(singaporeEnd, rest.at(-1)!.receivedAtMs + 1_000);
    for (const p of next) source.push(p.bytes, p.receivedAtMs);
    await run.pipeline.stop();
    const files = recordingsOf(place.recordingsDir);
    expect(files).toHaveLength(2);
    const other = files.find((f) => f !== file)!;
    expect((await datagramPayloads(other)).length).toBeGreaterThan(0);
    const nextRow = rowOf(place.db, uidOf(next));
    expect(nextRow.pwrec_path).toBe(other);
    expect(factRows(place.db, keyOfRow(nextRow)).length).toBeGreaterThan(0);
    // the ended session's row, facts and recording are as they were at its end
    expect(everything(place.db).facts.filter((f) => (f as { session_uid: string }).session_uid !== uidOf(next))).toEqual(stored.facts);
    expect(readFileSync(file!).equals(bytes)).toBe(true);
    expect(run.messages.slice(seenBefore).some((m) => m.id === 'session.info')).toBe(true);
    expect(run.value('feed.status')).toMatchObject({ sessionEnded: false });
    expect(run.errors()).toEqual([]);
  });

  it('is invalid without a running session: before any session, and once the session ended (C73)', async () => {
    const place = newPlace();
    const source = new ManualSource(F);
    const run = livePipeline(source, { place });
    run.pipeline.start();
    expect(endSession(run.pipeline)).toMatchObject({ ok: false, reason: 'invalid' });
    const { first } = splitAtSession(pitExit);
    for (const p of first) source.push(p.bytes, p.receivedAtMs);
    expect(endSession(run.pipeline)).toEqual({ ok: true });
    expect(endSession(run.pipeline)).toMatchObject({ ok: false, reason: 'invalid' });
    await run.pipeline.stop();
    // nothing was written before the session: no row, no recording
    expect(sessionRows(place.db)).toHaveLength(1);
    expect(recordingsOf(place.recordingsDir)).toHaveLength(1);
    expect(run.errors()).toEqual([]);
  });
});

describe('a stored complete session is never replaced or reopened (C24, C59)', { timeout: 180_000 }, () => {
  it('after the game ended a session (SEND) and it was stored complete, a Session packet of its key changes nothing', async () => {
    const place = newPlace();
    const source = new ManualSource(F);
    const run = livePipeline(source, { place });
    run.pipeline.start();
    for (const p of qualifyingEnd) source.push(p.bytes, p.receivedAtMs);
    // the same session's packets again, past SEND's grace window: from its first Session packet on
    const again = shifted(qualifyingEnd.slice(qualifyingEnd.findIndex(isSession)), qualifyingEnd.at(-1)!.receivedAtMs + 60_000);
    // the first packet past the grace window ends the session; it is stored complete before the repeat goes on
    source.push(again[0]!.bytes, again[0]!.receivedAtMs);
    const [file] = recordingsOf(place.recordingsDir);
    await vi.waitFor(() => expect(closed(file!)).toBe(true));
    expect(sessionRows(place.db).map((r) => r.complete)).toEqual([1]);
    const stored = everything(place.db);
    const bytes = readFileSync(file!);
    for (const p of again.slice(1)) source.push(p.bytes, p.receivedAtMs);
    await run.pipeline.stop();
    expect(everything(place.db)).toEqual(stored);
    expect(recordingsOf(place.recordingsDir)).toEqual([file]);
    expect(readFileSync(file!).equals(bytes)).toBe(true);
    expect(run.errors()).toEqual([]);
  });

  it('after a bridge restart, packets of a session stored complete neither resume its recording nor touch its row or facts', async () => {
    const place = newPlace();
    // the first run: the whole session, ended by the game (SEND), stored complete
    const firstRun = await streamRun(qualifyingEnd, place);
    expect(firstRun.errors()).toEqual([]);
    expect(sessionRows(place.db).map((r) => r.complete)).toEqual([1]);
    const [file] = recordingsOf(place.recordingsDir);
    const stored = everything(place.db);
    const bytes = readFileSync(file!);

    // the restarted bridge gets the same session's packets again, on its own receive clock
    const restarted = livePipeline(new ArraySource(F, shifted(qualifyingEnd, 7_000_000)), { place, wallMs: W0 + 3_600_000 });
    const seenBefore = restarted.messages.length;
    restarted.pipeline.start();
    await restarted.pipeline.done;
    expect(restarted.errors()).toEqual([]);
    expect(everything(place.db)).toEqual(stored);
    expect(recordingsOf(place.recordingsDir)).toEqual([file]);
    expect(readFileSync(file!).equals(bytes)).toBe(true);
    // nothing of it is published but the feed's health
    expect(restarted.messages.slice(seenBefore).filter((m) => m.id !== 'feed.status' && m.type !== 'snapshot')).toEqual([]);
    expect(restarted.value('session.info')).toBeUndefined();
  });

  it('after session.end and a bridge restart, the rest of that session changes nothing', async () => {
    const { first, rest } = splitAtSession(pitExit);
    const place = newPlace();
    const source = new ManualSource(F);
    const run = livePipeline(source, { place });
    run.pipeline.start();
    for (const p of first) source.push(p.bytes, p.receivedAtMs);
    expect(endSession(run.pipeline)).toEqual({ ok: true });
    await run.pipeline.stop();
    const [file] = recordingsOf(place.recordingsDir);
    expect(closed(file!)).toBe(true);
    const stored = everything(place.db);
    const bytes = readFileSync(file!);

    const restarted = await streamRun(shifted(rest, 7_000_000), place, W0 + 3_600_000);
    expect(restarted.errors()).toEqual([]);
    expect(everything(place.db)).toEqual(stored);
    expect(recordingsOf(place.recordingsDir)).toEqual([file]);
    expect(readFileSync(file!).equals(bytes)).toBe(true);
  });
});

describe('stale stored sessions are completed in the background (C24, C59, C61)', { timeout: 300_000 }, () => {
  /** A CLI io whose `err` lines are kept. */
  const memoryIo = () => {
    const err: string[] = [];
    const io: CliIo = { out: () => {}, err: (l) => err.push(l), env: {}, signal: new AbortController().signal };
    return { io, err };
  };

  it('a new live session completes a stale session of another weekend from its recording; one whose recording is missing stays, logged', async () => {
    const place = newPlace();
    // two sessions of other weekends, each stopped mid-way (a bridge stop): stored incomplete
    const staleA = singaporeStart.slice(0, Math.floor(singaporeStart.length / 2));
    const staleB = driveThrough.slice(0, Math.floor(driveThrough.length / 2));
    await stoppedRun(staleA, place);
    const fileA = recordingsOf(place.recordingsDir)[0]!;
    await stoppedRun(shifted(staleB, staleA.at(-1)!.receivedAtMs + 1_000), place, W0 + 600_000);
    const fileB = recordingsOf(place.recordingsDir).find((f) => f !== fileA)!;
    const [uidA, uidB] = [uidOf(staleA), uidOf(staleB)];
    expect([rowOf(place.db, uidA).complete, rowOf(place.db, uidB).complete]).toEqual([0, 0]);
    expect(rowOf(place.db, uidA).pwrec_path).toBe(fileA);
    // B's recording is gone (deleted by the user, a lost disk)
    rmSync(fileB);
    const factsB = factRows(place.db, keyOfRow(rowOf(place.db, uidB)));

    // A as a rebuild of its recording stores it (the reference)
    const reference = openDatabase(join(tmp(), 'reference.db'));
    await processRecording(fileA, reference, createLogger({ level: 'silent' }), new AbortController().signal, effectiveConfig(FEATURES), RULES);
    const wantedA = factRows(reference, keyOfRow(rowOf(reference, uidA)));
    expect(wantedA.length).toBeGreaterThan(0);

    // a new live session of a third weekend, on the live bridge's rebuild
    const { io, err } = memoryIo();
    const rebuild = vi.fn(sessionRebuilder(place.db, effectiveConfig(FEATURES), io, RULES));
    const run = livePipeline(new ArraySource(F, shifted(pitExit, staleB.at(-1)!.receivedAtMs + 60_000)), { place, wallMs: W0 + 1_200_000, storage: { rebuild } });
    run.pipeline.start();
    await run.pipeline.done;
    expect(run.errors()).toEqual([]);

    // A is completed in the background: its log replaced whole by its recording's, closing spans included
    await vi.waitFor(() => expect(rowOf(place.db, uidA).complete).toBe(1), { timeout: 60_000, interval: 100 });
    expect(factRows(place.db, keyOfRow(rowOf(place.db, uidA)))).toEqual(wantedA);
    expect(rowOf(place.db, uidA).pwrec_path).toBe(fileA);
    // B stays as it was, and that is logged
    expect(rebuild.mock.calls.map(([row]: [StoredSessionRow]) => String(row.sessionUid)).sort()).toEqual([uidA, uidB].sort());
    expect(rowOf(place.db, uidB).complete).toBe(0);
    expect(factRows(place.db, keyOfRow(rowOf(place.db, uidB)))).toEqual(factsB);
    expect([...err, ...run.lines.map((l) => JSON.stringify(l))].some((line) => line.includes(uidB) && /missing/.test(line))).toBe(true);
    // the new session itself is recorded and stored as any live session
    expect(rowOf(place.db, uidOf(pitExit)).complete).toBe(1);
  });

  it('a restarted run that continues its stored session starts no sweep of the other stale sessions', async () => {
    const place = newPlace();
    const stale = singaporeStart.slice(0, Math.floor(singaporeStart.length / 2));
    await stoppedRun(stale, place);
    const { first, rest } = splitAtSession(pitExit);
    const firstPart = shifted(first, stale.at(-1)!.receivedAtMs + 60_000);
    await stoppedRun(firstPart, place, W0 + 600_000);
    expect(sessionRows(place.db).map((r) => r.complete)).toEqual([0, 0]);

    const rebuild = vi.fn(async (_row: StoredSessionRow) => {});
    const restPart = shifted(rest, 7_000_000);
    const restarted = livePipeline(new ArraySource(F, restPart), { place, wallMs: W0 + 600_000 + (rest[0]!.receivedAtMs - first.find(isSession)!.receivedAtMs), storage: { rebuild } });
    restarted.pipeline.start();
    await restarted.pipeline.done;
    expect(restarted.errors()).toEqual([]);
    // the continued session is complete; the stale one waits for a session that continues nothing
    expect(rowOf(place.db, uidOf(pitExit)).complete).toBe(1);
    expect(rebuild).not.toHaveBeenCalled();
    expect(rowOf(place.db, uidOf(stale)).complete).toBe(0);
  });
});
