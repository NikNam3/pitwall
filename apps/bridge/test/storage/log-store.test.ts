// Storage as an append-only cache of the logs (Task 27; C24, C26, C28, C34, C38, C60, C61), on real data and through
// the pipeline: a live session appends its log frame by frame (a flashback included) and is complete once finish()'s
// closing spans are written; reprocessing writes the same log once, at the end; a session the bridge left incomplete is
// rebuilt from its recording before it is read. Every read is the projection, and membership over it equals the live one.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import type { CarId, FeedId } from '@pitwall/domain';
import { membershipOf, type Projection } from '@pitwall/engine/readers';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { processRecording } from '../../src/cli/process-recording.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource } from '../../src/input/packet-source.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { replayRunner } from '../fixtures/engine-replay.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { ArraySource } from '../helpers/array-source.ts';
import { factRows, forbidFactRewrites, keyOf } from './records.ts';

const F = 'store' as FeedId;
const silent = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'log-store-'));
const FLASHBACK = segmentPath('race-singapore-wet-flashback.pwrec.gz');

/** Runs `source` through a live pipeline that stores into `db`; returns what the insights topic carried. */
async function live(source: PacketSource, db: Db, recordingsDir?: string): Promise<{ sent: ServerMessage[] }> {
  let t = 0;
  const hub = new TopicHub({ now: () => (t += 1000) });
  const sent: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  hub.subscribe({ clientId: 'c', id: 'insights', topic: 'insights', params: {}, feedId: F });
  const pipeline = new FeedPipeline({ feedId: F, source, hub, features: FEATURES, log: silent,
    storage: { db, rulesVersion: 'unversioned', ...(recordingsDir !== undefined && { recordingsDir }) } });
  pipeline.start();
  await pipeline.done;
  return { sent };
}

/** The insight kinds raised on the insights topic. */
const raisedKinds = (sent: ServerMessage[]): string[] =>
  sent.flatMap((m) => ('entries' in m ? ((m.entries ?? []) as Array<{ type: string; insight?: { kind: string } }>) : []))
    .flatMap((e) => (e.type === 'raised' && e.insight ? [e.insight.kind] : []));

/** The one stored session's key: the database holds a single session here. */
const onlyKey = (db: Db): SessionKey => {
  const weekends = db.prepare('SELECT DISTINCT weekend_id FROM sessions').pluck().all() as string[];
  expect(weekends).toHaveLength(1);
  const rows = new WeekendRepository(db).sessionsOf(weekends[0]!);
  expect(rows).toHaveLength(1);
  return keyOf(rows[0]!);
};

/** Every fact of a projection that describes a frame, with its list (C26). */
const factsOf = (p: Projection) =>
  (['laps', 'stints', 'pitStops', 'crossings', 'events', 'penalties', 'clock'] as const).flatMap((list) =>
    (p[list] as ReadonlyArray<{ frame: number; carId?: CarId }>).map((fact) => ({ list, fact })));

describe('storage over a segment with a flashback (race-singapore-wet-flashback)', () => {
  let db: Db;
  let sent: ServerMessage[];
  let liveProjection: Projection;
  let key: SessionKey;

  beforeAll(async () => {
    db = openDatabase(join(tmp(), 'live.db'));
    forbidFactRewrites(db);
    ({ sent } = await live(new PwrecSource({ feedId: F, path: FLASHBACK, mode: 'asFastAsPossible' }), db));
    const runner = await replayRunner(FLASHBACK);
    runner.finish();
    liveProjection = runner.state.history;
    key = onlyKey(db);
  });

  it('a flashback writes its void and deletes no row (C24, C27)', () => {
    expect(raisedKinds(sent)).not.toContain('system.storageWriteFailed');
    expect(factRows(db, key).filter((r) => r.list === 'voids').length).toBeGreaterThan(0);
  });

  it('the session is complete once finish()\'s closing spans are written', () => {
    expect(new WeekendRepository(db).sessionsOf(key.weekendId)).toEqual([expect.objectContaining({ complete: true, rulesVersion: 'unversioned' })]);
  });

  it('the stored projection equals the live projection (C28, C34)', async () => {
    expect(await new WeekendRepository(db).projectionOf(key)).toEqual(liveProjection);
  });

  it('membership over a stored projection (membershipOf with history only) equals the live one (C26)', async () => {
    const storedProjection = (await new WeekendRepository(db).projectionOf(key))!;
    const facts = factsOf(storedProjection);
    expect(facts.length).toBeGreaterThan(0);
    const memberships = facts.map(({ fact }) => membershipOf({ history: storedProjection }, fact));
    expect(memberships.some((m) => Object.keys(m).length > 0)).toBe(true);
    expect(memberships).toEqual(facts.map(({ fact }) => membershipOf({ history: liveProjection }, fact)));
  });

  it('reprocessing writes the same log once, at its end: its projection equals the live one (C38)', async () => {
    const replayed = openDatabase(join(tmp(), 'reprocess.db'));
    await processRecording(FLASHBACK, replayed, silent, new AbortController().signal, loadFeatureConfig(tmp(), FEATURES));
    const k = onlyKey(replayed);
    expect(k).toEqual(key);
    expect(new WeekendRepository(replayed).sessionsOf(k.weekendId)).toEqual([expect.objectContaining({ complete: true, pwrecPath: FLASHBACK })]);
    expect(await new WeekendRepository(replayed).projectionOf(k)).toEqual(liveProjection);
  });
});

describe('storage: a session the bridge left incomplete', () => {
  const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;
  const packets = () => new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(20, () => {}).event(FTLP).frames(20, () => {})
    .packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

  it('is rebuilt from its recording before it is read (C61)', async () => {
    const db = openDatabase(join(tmp(), 'killed.db'));
    const recordings = tmp();
    await live(new ArraySource(F, packets()), db, recordings);
    const key = onlyKey(db);
    const complete = await new WeekendRepository(db).projectionOf(key);
    expect(complete?.events.length).toBeGreaterThan(0);
    // as if the bridge was killed mid-session: part of the log written, never marked complete
    db.prepare("UPDATE sessions SET complete = 0").run();
    db.prepare("DELETE FROM facts WHERE list = 'events' OR list LIKE 'spans:%'").run();
    const [file] = readdirSync(recordings).filter((name) => name.endsWith('.pwrec.gz'));
    const config = loadFeatureConfig(tmp(), FEATURES);
    const rebuilt: string[] = [];
    const repo = new WeekendRepository(db, {
      log: silent,
      rebuild: async (row) => {
        rebuilt.push(row.pwrecPath!);
        await processRecording(row.pwrecPath!, db, silent, new AbortController().signal, config);
      },
    });
    expect(await repo.projectionOf(key)).toEqual(complete);
    expect(rebuilt).toEqual([join(recordings, file!)]);
    expect(repo.sessionsOf(key.weekendId)).toEqual([expect.objectContaining({ complete: true })]);
  });
});
