// SP4.3d2 Task 5 fix round, P1 (C59, C61, C24, C38; ruling R21): `pitwall live`'s startup rebuild
// (`StaleSessions.rebuildNewestWeekend`) of a stored session whose recording holds no session end (the bridge was stopped
// mid-session) replaces its log and leaves its row incomplete. When the game's packets of that session arrive, the feed's
// resume path then continues its recording (C59): the same file grows, no second recording is made, and the stored log
// grows to that of one run that never stopped (C38), each fact once (C24).
//
// The session is a committed segment (C84) split at a Session packet: the first run gets the first part and is stopped,
// the startup rebuild runs on its database, then the restarted run gets the rest on another receive-clock origin. Data
// dirs, databases and recordings are temporary directories the tests make (C84).
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { PacketId, peekHeader } from '@pitwall/protocol';
import type { CliIo } from '../../src/cli/io.ts';
import { StaleSessions } from '../../src/cli/rebuild-database.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource } from '../../src/input/packet-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { factRows } from '../storage/records.ts';

const F = 'live' as FeedId;
const SEGMENT = segmentPath('race-zandvoort-pit-exit.pwrec.gz');
const tmp = () => mkdtempSync(join(tmpdir(), 'startup-rebuild-continues-'));
const W0 = Date.UTC(2026, 10, 15, 12, 0, 0);
/** The restarted process's monotonic clock starts elsewhere: its receive times are on another origin. */
const RESTART_ORIGIN_MS = 7_000_000;
const silent = createLogger({ level: 'silent' });

type Segment = { packets: PreparedPacket[]; first: PreparedPacket[]; rest: PreparedPacket[]; originMs: number };

const isSession = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.session && header.sessionUid !== 0n;
};
const isSendEvent = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.event && new TextDecoder().decode(p.bytes.subarray(29, 33)) === 'SEND';
};

async function loadSegment(): Promise<Segment> {
  const packets: PreparedPacket[] = [];
  for await (const r of readPwrec(SEGMENT)) packets.push({ bytes: r.payload, receivedAtMs: r.t });
  const split = packets.findIndex((p, i) => i >= Math.floor(packets.length / 2) && isSession(p));
  expect(split).toBeGreaterThan(0);
  const first = packets.slice(0, split);
  // the first part holds no session end: the bridge was stopped mid-session
  expect(first.some(isSendEvent)).toBe(false);
  return { packets, first, rest: packets.slice(split), originMs: packets.find(isSession)!.receivedAtMs };
}

type Place = { db: Db; recordingsDir: string };
const newPlace = (): Place => ({ db: openDatabase(join(tmp(), 'live.db')), recordingsDir: tmp() });

function livePipeline(source: PacketSource, place: Place, wallMs: number, rulesVersion: string) {
  return new FeedPipeline({
    feedId: F, source, hub: new TopicHub({ now: () => 0 }), features: [], log: silent, wallClock: () => wallMs,
    storage: { db: place.db, rulesVersion, recordingsDir: place.recordingsDir },
  });
}

const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name));
type SessionRowSql = { pwrec_path: string | null; rules_version: string; complete: number };
const onlyKey = (db: Db): SessionKey => {
  const rows = db.prepare('SELECT session_uid, weekend_id, player_car FROM sessions').all() as Array<{ session_uid: string; weekend_id: string; player_car: number }>;
  expect(rows).toHaveLength(1);
  return { sessionUid: rows[0]!.session_uid, weekendId: rows[0]!.weekend_id, playerCar: rows[0]!.player_car } as SessionKey;
};
const rowOf = (db: Db, key: SessionKey): SessionRowSql =>
  db.prepare('SELECT pwrec_path, rules_version, complete FROM sessions WHERE session_uid = ? AND weekend_id = ? AND player_car = ?')
    .get(key.sessionUid, key.weekendId, key.playerCar) as SessionRowSql;
async function datagramCount(path: string): Promise<number> {
  let n = 0;
  for await (const _ of readPwrec(path)) n++;
  return n;
}

/** The startup rebuild as `pitwall live` runs it, before input opens, under `rulesVersion`. */
async function startupRebuild(db: Db, rulesVersion: string): Promise<string[]> {
  const err: string[] = [];
  const io: CliIo = { out: () => {}, err: (line) => err.push(line), env: {}, signal: new AbortController().signal };
  expect(await new StaleSessions(db, loadFeatureConfig(tmp(), FEATURES), io, rulesVersion).rebuildNewestWeekend()).toBe(true);
  return err.filter((line) => /rebuilding \d+\/\d+: /.test(line));
}

let segment: Segment;
beforeAll(async () => {
  segment = await loadSegment();
});

describe('a startup rebuild keeps an unended session open, and the restart continues its recording (C59, C61)', { timeout: 180_000 }, () => {
  it.each([
    ['the same rules version (stale: incomplete)', 'v1'],
    ['a changed rules version', 'v2'],
  ])('%s: the rebuilt row stays incomplete; the session\'s later packets continue the same recording to one run\'s log', async (_name, rebuildVersion) => {
    // the first run, stopped mid-session: stored incomplete, its recording without SEND
    const place = newPlace();
    const source = new ManualSource(F);
    const first = livePipeline(source, place, W0, 'v1');
    first.start();
    for (const p of segment.first) source.push(p.bytes, p.receivedAtMs);
    await first.stop();
    const key = onlyKey(place.db);
    const [file] = recordingsOf(place.recordingsDir);
    expect(rowOf(place.db, key)).toMatchObject({ pwrec_path: file, complete: 0 });
    const recordedBefore = await datagramCount(file!);

    // `pitwall live` starts: the newest weekend's stale session is rebuilt from its recording ...
    expect(await startupRebuild(place.db, rebuildVersion)).toHaveLength(1);
    // ... its log replaced under the current rules version as a stopped run writes it (no session end applied), its row
    // left incomplete
    expect(rowOf(place.db, key)).toMatchObject({ pwrec_path: file, rules_version: rebuildVersion, complete: 0 });
    const rebuilt = factRows(place.db, key);
    expect(rebuilt.length).toBeGreaterThan(0);

    // the game sends the rest of the session: the feed's resume path continues its recording
    const restarted = segment.rest.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - segment.rest[0]!.receivedAtMs + RESTART_ORIGIN_MS }));
    const again = livePipeline(new ArraySource(F, restarted), place, W0 + (segment.rest[0]!.receivedAtMs - segment.originMs), rebuildVersion);
    again.start();
    await again.done;
    // the same file, grown by the rest; no second recording
    expect(recordingsOf(place.recordingsDir)).toEqual([file]);
    expect(await datagramCount(file!)).toBe(recordedBefore + segment.rest.length);
    expect(onlyKey(place.db)).toEqual(key);
    // the log grew to that of one run that never stopped, each fact once
    const after = factRows(place.db, key);
    expect(after.length).toBeGreaterThan(rebuilt.length);
    const whole = newPlace();
    const oneRun = livePipeline(new ArraySource(F, segment.packets), whole, W0, rebuildVersion);
    oneRun.start();
    await oneRun.done;
    expect(after).toEqual(factRows(whole.db, onlyKey(whole.db)));
    expect(rowOf(place.db, key)).toMatchObject({ pwrec_path: file, rules_version: rebuildVersion, complete: 1 });
  });
});
