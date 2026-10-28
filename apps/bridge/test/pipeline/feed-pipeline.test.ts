import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { ServerMessage } from '@pitwall/contracts';
import { PacketId } from '@pitwall/protocol';
import { ScenarioBuilder, buildPacket, headerFor, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { defineFeature } from '../../src/features/feature.ts';
import sessionInfo from '../../src/features/session-info/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource } from '../../src/input/packet-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import type { PwrecMeta, PwrecRecord } from '../../src/pwrec/types.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const tmp = () => mkdtempSync(join(tmpdir(), 'pipeline-'));
const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;
type Timed = ReturnType<ScenarioBuilder['packets']>;
const toPrepared = (packets: Timed): PreparedPacket[] => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
const prepared = (b: ScenarioBuilder): PreparedPacket[] => toPrepared(b.packets());
const scenario = (uid = 77n) => prepared(new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants().frames(5, () => {})
  .event(FTLP).frames(5, () => {}));
const shifted = (packets: PreparedPacket[], ms: number): PreparedPacket[] => packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs + ms }));

type Options = {
  features?: typeof FEATURES;
  storage?: object;
  dumpsDir?: string;
  topics?: Array<[string, object]>;
  wallClock?: () => number;
  staleCheck?: { clock: () => number; everyMs: number };
};

function harness(source: PacketSource, o: Options = {}) {
  let t = 0; const hub = new TopicHub({ now: () => (t += 1000) }); const sent: ServerMessage[] = []; const logs: string[] = [];
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  for (const [topic, params] of o.topics ?? [['session.info', {}], ['events', {}], ['insights', {}], ['feed.status', {}]])
    hub.subscribe({ clientId: 'c', id: topic, topic: topic as never, params, feedId: F });
  const log = createLogger({ level: 'debug', destination: new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } }) });
  const pipeline = new FeedPipeline({ feedId: F, source, hub, features: o.features ?? FEATURES, log,
    ...(o.storage ? { storage: o.storage as never } : {}), ...(o.dumpsDir ? { dumpsDir: o.dumpsDir } : {}),
    ...(o.wallClock ? { wallClock: o.wallClock } : {}), ...(o.staleCheck ? { staleCheck: o.staleCheck } : {}) });
  const of = (id: string) => sent.filter((m) => 'id' in m && m.id === id);
  type Entry = { type: string; key?: string; at?: number; insight?: { key: string; kind: string; severity: string; params: object; raisedAt: number } };
  const entries = () => of('insights').flatMap((m) => ('entries' in m ? (m.entries as Entry[]) : []));
  const raised = () => entries().filter((e) => e.type === 'raised').map((e) => e.insight!);
  return { pipeline, of, raised, entries, logs };
}

async function run(packets: PreparedPacket[], o: Options = {}) {
  const h = harness(new ArraySource(F, packets), o);
  h.pipeline.start(); await h.pipeline.done;
  return h;
}

async function readAll(path: string): Promise<{ records: PwrecRecord[]; meta: PwrecMeta; endedCleanly: boolean; durationMs: number | undefined }> {
  const records: PwrecRecord[] = []; const it = readPwrec(path);
  for (let r = await it.next(); ; r = await it.next()) {
    if (r.done) return { records, meta: r.value.meta, endedCleanly: r.value.endedCleanly, durationMs: r.value.durationMs };
    records.push(r.value);
  }
}

describe('FeedPipeline', () => {
  it('publishes session.info, history appends and feed.status', async () => {
    const r = await run(scenario());
    expect(r.of('session.info').find((m) => m.type === 'update')).toMatchObject({ value: { feedId: F, sessionUid: '77' } });
    expect(r.of('events').flatMap((m) => ('entries' in m ? m.entries ?? [] : []))).toMatchObject([{ kind: 'fastestLap' }]);
    expect(r.of('feed.status').some((m) => m.type === 'update')).toBe(true);
  });
  it('feed.status carries the median session-time step of the closed frames as cadenceMs', async () => {
    const r = await run(scenario());
    expect(r.of('feed.status').at(-1)).toMatchObject({ value: { cadenceMs: 16 } });
  });
  it('wrong packet format → decode error metrics + critical feed.wrongFormat, before any session', async () => {
    const bad = packetBytes(buildPacket('session', { header: headerFor('session', { packetFormat: 2024 }) }));
    const r = await run([{ bytes: bad, receivedAtMs: 0 }]);
    expect(r.raised()).toEqual([expect.objectContaining({ kind: 'feed.wrongFormat', severity: 'critical', params: { format: 2024 } })]);
    expect(r.of('feed.status').at(-1)).toMatchObject({ value: { decodeErrors: 1, wrongFormat: 2024 } });
  });
  it('a new session resets the feed topics', async () => {
    const second = scenario(78n).map((p) => ({ ...p, receivedAtMs: p.receivedAtMs + 60_000 }));
    const r = await run([...scenario(), ...second]);
    expect(r.of('events').filter((m) => m.type === 'snapshot').at(-1)).toEqual({ type: 'snapshot', id: 'events', entries: [] });
    expect(r.of('session.info').filter((m) => m.type === 'update').at(-1)).toMatchObject({ value: { sessionUid: '78' } });
  });
  it('writes one .pwrec per session when recordingsDir is set', async () => {
    const dir = tmp(); const packets = scenario();
    await run(packets, { storage: { db: openDatabase(join(tmp(), 'p.db')), recordingsDir: dir } });
    const files = readdirSync(dir); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_000000000000004d\.pwrec\.gz$/);
    let n = 0; for await (const _ of readPwrec(join(dir, files[0]!))) n++;
    expect(n).toBe(packets.length);
  });
  it('storage failure → advisory system.storageWriteFailed, live topics continue', async () => {
    const db = openDatabase(join(tmp(), 's.db')); db.close();
    const r = await run(scenario(), { storage: { db } });
    expect(r.raised().filter((i) => i.kind === 'system.storageWriteFailed')).toEqual([expect.objectContaining({ severity: 'advisory' })]);
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
  it('pwrec write failure → critical system.pwrecWriteFailed, live topics continue', async () => {
    const file = join(tmp(), 'not-a-dir'); writeFileSync(file, '');
    const r = await run(scenario(), { storage: { db: openDatabase(join(tmp(), 'w.db')), recordingsDir: join(file, 'sub') } });
    expect(r.raised().filter((i) => i.kind === 'system.pwrecWriteFailed')).toEqual([expect.objectContaining({ severity: 'critical' })]);
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
  it('an exception while processing a frame: frame skipped, error logged, debug dump written (max 20)', async () => {
    const boom = defineFeature({ name: 'boom', calculators: [{ kind: 'quick', id: 'boom', reads: ['timing'], cadence: 'frame', compute: () => 1 }],
      topics: [{ topic: 'car.telemetry', from: 'boom', select: () => { throw new Error('select failed'); } }] });
    const dumps = tmp();
    const r = await run(scenario(), { features: [sessionInfo, boom], dumpsDir: dumps, topics: [['session.info', {}], ['car.telemetry', { carId: 0 }]] });
    const err = r.logs.map((l) => JSON.parse(l)).find((l) => l.level === 50)!;
    expect(err).toMatchObject({ feedId: F, sessionUid: '77' }); expect(JSON.stringify(err)).toContain('select failed');
    const files = readdirSync(dumps); expect(files.length).toBeGreaterThan(0); expect(files.length).toBeLessThanOrEqual(20);
    const dump = JSON.parse(readFileSync(join(dumps, files[0]!), 'utf8'));
    expect(files[0]).toBe(`test-77-${dump.frame.frameId}.json`);
    expect(dump).toMatchObject({ feedId: F, sessionUid: '77', frame: { sessionUid: '77' }, pwrec: { t: expect.any(Number) } });
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
});

describe('FeedPipeline: debug dumps', () => {
  const boom = defineFeature({ name: 'boom', calculators: [{ kind: 'quick', id: 'boom', reads: ['timing'], cadence: 'frame', compute: () => 1 }],
    topics: [{ topic: 'car.telemetry', from: 'boom', select: () => { throw new Error('select failed'); } }] });
  const failing = (uid: bigint, frames: number) => prepared(new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants().frames(frames, () => {}));
  const options = (dumpsDir: string): Options => ({ features: [sessionInfo, boom], dumpsDir, topics: [['session.info', {}], ['car.telemetry', { carId: 0 }]] });

  it('writes at most 20 dumps per session', async () => {
    const dumps = tmp();
    await run([...failing(77n, 30), ...shifted(failing(78n, 30), 60_000)], options(dumps));
    const names = readdirSync(dumps);
    expect(names.filter((n) => n.startsWith('test-77-'))).toHaveLength(20);
    expect(names.filter((n) => n.startsWith('test-78-'))).toHaveLength(20);
  });
  it('without a session file the dump position is the last receivedAtMs and has no path', async () => {
    const dumps = tmp(); const packets = failing(77n, 10);
    await run(packets, options(dumps));
    const dump = JSON.parse(readFileSync(join(dumps, readdirSync(dumps)[0]!), 'utf8'));
    expect(dump.pwrec.path).toBeUndefined();
    expect(dump.pwrec.t).toBeGreaterThanOrEqual(0); expect(dump.pwrec.t).toBeLessThanOrEqual(packets.at(-1)!.receivedAtMs);
  });
  it('with a session file the dump names it and the time inside it', async () => {
    const dumps = tmp(); const recordings = tmp();
    await run(failing(77n, 10), { ...options(dumps), storage: { db: openDatabase(join(tmp(), 'd.db')), recordingsDir: recordings } });
    const dump = JSON.parse(readFileSync(join(dumps, readdirSync(dumps)[0]!), 'utf8'));
    expect(dump.pwrec).toEqual({ path: join(recordings, readdirSync(recordings)[0]!), t: expect.any(Number) });
  });
});

describe('FeedPipeline: session start', () => {
  const lateParticipants = (framesBefore: number) => {
    const packets = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().frames(2, () => {}).event(FTLP).frames(framesBefore - 2, () => {}).participants().frames(5, () => {}).packets();
    const defaultParticipants = packets.findIndex((p) => p.packet.header.packetId === PacketId.participants);
    return toPrepared(packets.filter((_, i) => i !== defaultParticipants));
  };

  it('buffers the frames before the first Participants packet instead of losing them', async () => {
    const r = await run(lateParticipants(5));
    expect(r.of('session.info').find((m) => m.type === 'update')).toMatchObject({ value: { feedId: F, sessionUid: '77' } });
    expect(r.of('events').flatMap((m) => ('entries' in m ? m.entries ?? [] : []))).toMatchObject([{ kind: 'fastestLap' }]);
  });
  it('starts without a weekend after 600 buffered frames', async () => {
    const all = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().frames(5, () => {}).event(FTLP).frames(640, () => {}).packets();
    const r = await run(toPrepared(all.filter((p) => p.packet.header.packetId !== PacketId.participants)));
    expect(r.of('session.info').find((m) => m.type === 'update')).toMatchObject({ value: { sessionUid: '77' } });
    expect(r.of('events').flatMap((m) => ('entries' in m ? m.entries ?? [] : []))).toMatchObject([{ kind: 'fastestLap' }]);
  });
  it('stores the session with its drivers once Participants arrived', async () => {
    const db = openDatabase(join(tmp(), 'late.db'));
    await run(lateParticipants(5), { storage: { db } });
    const [row] = new WeekendRepository(db).sessionsOf('0');
    expect(row).toMatchObject({ sessionUid: '77', pwrecPath: null });
    expect(row!.drivers.map((d) => d.carId)).toEqual([0, 1]);
  });
});

describe('FeedPipeline: session files', () => {
  it('names the file after wallClock() and the session uid, with the bridge as recorder', async () => {
    const dir = tmp(); const at = new Date(2026, 9, 28, 13, 5, 9);
    await run(scenario(), { storage: { db: openDatabase(join(tmp(), 'n.db')), recordingsDir: dir }, wallClock: () => at.getTime() });
    expect(readdirSync(dir)).toEqual(['2026-10-28_13-05-09_000000000000004d.pwrec.gz']);
    const { meta, endedCleanly } = await readAll(join(dir, readdirSync(dir)[0]!));
    expect(meta).toMatchObject({ recorderVersion: 'pitwall-bridge', startedAt: at.toISOString(), listenPort: 0 });
    expect(endedCleanly).toBe(true);
  });
  it('closes the file of a session when the next one starts; times are relative to each file', async () => {
    const dir = tmp(); const first = scenario(77n); const second = shifted(scenario(78n), 60_000);
    await run([...first, ...second], { storage: { db: openDatabase(join(tmp(), 'two.db')), recordingsDir: dir } });
    const files = readdirSync(dir).sort(); expect(files).toHaveLength(2);
    const a = await readAll(join(dir, files.find((f) => f.endsWith('_000000000000004d.pwrec.gz'))!));
    const b = await readAll(join(dir, files.find((f) => f.endsWith('_000000000000004e.pwrec.gz'))!));
    expect([a.records.length, b.records.length]).toEqual([first.length, second.length]);
    expect(a.endedCleanly && b.endedCleanly).toBe(true);
    expect(a.records[0]!.t).toBe(0); expect(b.records[0]!.t).toBe(0);
    expect(b.records.at(-1)!.t).toBe(second.at(-1)!.receivedAtMs - 60_000);
  });
  it('keeps the raw datagrams byte for byte', async () => {
    const dir = tmp(); const packets = scenario();
    await run(packets, { storage: { db: openDatabase(join(tmp(), 'raw.db')), recordingsDir: dir } });
    const { records } = await readAll(join(dir, readdirSync(dir)[0]!));
    expect(records.map((r) => [...r.payload])).toEqual(packets.map((p) => [...p.bytes]));
  });
  it('records the session in the database with the file path', async () => {
    const dir = tmp(); const db = openDatabase(join(tmp(), 'row.db'));
    await run(scenario(), { storage: { db, recordingsDir: dir }, wallClock: () => Date.UTC(2026, 9, 28, 12, 0, 0) });
    expect(new WeekendRepository(db).sessionsOf('0')).toMatchObject([{ sessionUid: '77', pwrecPath: join(dir, readdirSync(dir)[0]!), startedAt: '2026-10-28T12:00:00.000Z' }]);
  });
  it('without recordingsDir no file is written and the session has no path', async () => {
    const db = openDatabase(join(tmp(), 'nofile.db'));
    await run(scenario(), { storage: { db } });
    expect(new WeekendRepository(db).sessionsOf('0')).toMatchObject([{ sessionUid: '77', pwrecPath: null }]);
  });
  it('replaying a recording keeps startedAt deterministic: source startedAt + record time', async () => {
    const sourcePath = join(tmp(), 'source.pwrec.gz');
    const writer = PwrecWriter.create(sourcePath, { recorderVersion: 'test', startedAt: '2026-01-01T10:00:00.000Z', listenPort: 20_777 });
    const packets = shifted(scenario(), 5000);
    packets.forEach((p) => writer.write(p.receivedAtMs, p.bytes));
    await writer.close(packets.at(-1)!.receivedAtMs + 1);
    const dir = tmp(); const db = openDatabase(join(tmp(), 'replay.db'));
    await run(packets, { storage: { db, recordingsDir: dir, sourcePath }, wallClock: () => Date.UTC(2030, 0, 1) });
    expect(new WeekendRepository(db).sessionsOf('0')).toMatchObject([{ startedAt: '2026-01-01T10:00:05.000Z' }]);
    expect((await readAll(join(dir, readdirSync(dir)[0]!))).meta.startedAt).toBe('2026-01-01T10:00:05.000Z');
  });
});

describe('FeedPipeline: flashback', () => {
  // The game rewinds to frame 30 after frame 59: frameIdentifier goes back while overallFrameIdentifier keeps rising.
  const flashbackPackets = () => {
    const original = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(40, () => {}).event(FTLP).frames(20, () => {});
    const continuation = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(80, () => {}).packets()
      .filter((p) => p.packet.header.frameIdentifier > 30 && p.packet.header.frameIdentifier < 80);
    const rewound = continuation.map(({ packet, receivedAtMs }) => ({
      packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: packet.header.frameIdentifier + 29 } },
      receivedAtMs: receivedAtMs + 29 * 16,
    }));
    return [...prepared(original), ...toPrepared(rewound)];
  };

  it('truncates the history topics and raises, then resolves, an info session.flashback insight', async () => {
    const r = await run(flashbackPackets());
    const appended = r.of('events').flatMap((m) => (m.type === 'append' || m.type === 'snapshot' ? m.entries ?? [] : []));
    expect(appended).toMatchObject([{ kind: 'fastestLap' }]);
    expect(r.of('events').at(-1)).toEqual({ type: 'snapshot', id: 'events', entries: [] });
    const flashback = r.raised().filter((i) => i.kind === 'session.flashback');
    expect(flashback).toEqual([expect.objectContaining({ severity: 'info', params: { targetLap: expect.any(Number), rewoundS: expect.any(Number) } })]);
    expect(flashback[0]!.params).toMatchObject({ rewoundS: expect.closeTo(0.464, 0) });
    expect(r.entries().filter((e) => e.type === 'resolved')).toEqual([{ type: 'resolved', key: flashback[0]!.key, at: flashback[0]!.raisedAt }]);
  });
});

describe('FeedPipeline: live feed', () => {
  it('stop() stops the source, closes the session file and settles done', async () => {
    const dir = tmp(); const packets = scenario();
    const source = new ManualSource(F);
    const h = harness(source, { storage: { db: openDatabase(join(tmp(), 'stop.db')), recordingsDir: dir } });
    h.pipeline.start();
    packets.forEach((p) => source.push(p.bytes, p.receivedAtMs));
    await h.pipeline.stop();
    await expect(h.pipeline.done).resolves.toBeUndefined();
    const { records, endedCleanly } = await readAll(join(dir, readdirSync(dir)[0]!));
    expect(records).toHaveLength(packets.length); expect(endedCleanly).toBe(true);
    expect(h.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
  it('staleCheck: a silent source raises feed.stale and reports the feed as stale', async () => {
    let now = 0; const source = new ManualSource(F);
    const h = harness(source, { staleCheck: { clock: () => now, everyMs: 5 } });
    h.pipeline.start();
    scenario().forEach((p) => source.push(p.bytes, 0));
    now = 5000;
    await vi.waitFor(() => expect(h.raised().filter((i) => i.kind === 'feed.stale')).toEqual([expect.objectContaining({ severity: 'advisory' })]));
    await vi.waitFor(() => expect(h.of('feed.status').at(-1)).toMatchObject({ value: { connected: true, stale: true } }));
    await h.pipeline.stop();
  });
});
