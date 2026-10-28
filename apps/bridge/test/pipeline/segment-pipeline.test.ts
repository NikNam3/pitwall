// The pipeline over a committed real segment: what gets stored, and that the session file is a faithful copy.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeedId, SessionUid } from '@pitwall/domain';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/tt-zandvoort-lap1.pwrec.gz');
const SESSION = '1895827638050388100' as SessionUid;
const F = 'replay' as FeedId;
const tmp = () => mkdtempSync(join(tmpdir(), 'segment-'));

async function datagrams(path: string): Promise<{ payloads: number[][]; startedAt: string; firstT: number }> {
  const payloads: number[][] = []; let firstT = -1; const it = readPwrec(path);
  for (let r = await it.next(); ; r = await it.next()) {
    if (r.done) return { payloads, startedAt: r.value.meta.startedAt, firstT };
    if (firstT < 0) firstT = r.value.t;
    payloads.push([...r.value.payload]);
  }
}

async function replay(storage: object): Promise<void> {
  const hub = new TopicHub({ now: () => performance.now() });
  const p = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }), hub, features: FEATURES,
    log: createLogger({ level: 'silent' }), storage: storage as never });
  p.start(); await p.done;
}

describe('FeedPipeline over the TT Zandvoort segment', () => {
  it('stores the session, its drivers and the confirmed laps', async () => {
    const db = openDatabase(join(tmp(), 'segment.db'));
    const source = await datagrams(SEGMENT);
    await replay({ db, sourcePath: SEGMENT });
    const repo = new WeekendRepository(db);
    const [row] = db.prepare('SELECT weekend_id FROM sessions WHERE session_uid = ?').all(SESSION) as Array<{ weekend_id: string }>;
    expect(row).toBeDefined();
    const [session] = repo.sessionsOf(row!.weekend_id);
    expect(session).toMatchObject({ sessionUid: SESSION, pwrecPath: null });
    expect(session!.drivers.length).toBeGreaterThan(0);
    expect(Date.parse(session!.startedAt)).toBeGreaterThanOrEqual(Date.parse(source.startedAt) + source.firstT);
    const laps = repo.lapsOf(SESSION);
    expect(laps.length).toBeGreaterThan(0); expect(laps.every((l) => l.status === 'confirmed' && l.lapTimeMs > 0)).toBe(true);
  });
  it('writes a session file with the datagrams of the segment, in order', async () => {
    const recordings = tmp();
    await replay({ db: openDatabase(join(tmp(), 'copy.db')), recordingsDir: recordings, sourcePath: SEGMENT });
    const files = readdirSync(recordings); expect(files).toHaveLength(1); expect(files[0]).toMatch(/_1a4f5531395c7884\.pwrec\.gz$/);
    const written = (await datagrams(join(recordings, files[0]!))).payloads; const source = (await datagrams(SEGMENT)).payloads;
    expect(written.length).toBeGreaterThan(0);
    expect(source.slice(source.length - written.length)).toEqual(written);
  });
});
