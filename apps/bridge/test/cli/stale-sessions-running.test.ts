// SP4.3e Task 7d fix round, F1 (C24, C59, C61): the live bridge's rebuilds (`StaleSessions`) hand the running sessions
// to the one rebuild service, so its checks (when queued, when it starts, at the swap) see every session a feed runs:
// `new StaleSessions(db, config, io, rulesVersion, { running })`, `running` the feeds' running sessions now (`serve`'s
// `running()`), read at every check, so a provider set before the pipelines exist sees them once they run.
//
// Temporary data dirs only (C84); the stored session is the committed segment race-zandvoort-lap10, stored by an
// earlier bridge stopped inside it (incomplete, so stale, C61).
import { afterEach, describe, expect, it } from 'vitest';
import { StaleSessions } from '../../src/cli/rebuild-database.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import type { SessionKey, StoredSessionRow } from '../../src/storage/db.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { factsWithRowids, NEW, newPlace, OLD, rowOf, storeSegment } from '../storage/rebuild-fixtures.ts';

const SEGMENT = 'race-zandvoort-lap10.pwrec.gz';

const closing: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

const quietIo = () => {
  const err: string[] = [];
  return { err, io: { out: () => {}, err: (line: string) => void err.push(line), env: {}, signal: new AbortController().signal } };
};

describe('StaleSessions passes the running sessions to the rebuild service (C59, C61)', { timeout: 120_000 }, () => {
  it('a stale session a feed runs is not rebuilt through StaleSessions: its row and facts stay the feed\'s', async () => {
    const place = newPlace();
    const { key } = await storeSegment(place, SEGMENT, OLD);
    place.db.prepare('UPDATE sessions SET complete = 0 WHERE session_uid = ? AND weekend_id = ? AND player_car = ?').run(key.sessionUid, key.weekendId, key.playerCar);
    const before = factsWithRowids(place.db, key);
    // set after construction, as `serve` sets its pipelines after the bridge made its rebuilds
    const running: SessionKey[] = [];
    const { io } = quietIo();
    const stale = new StaleSessions(place.db, effectiveConfig(FEATURES), io, NEW, { running: () => running });
    closing.push(() => stale.close());
    running.push(key);

    const row = new WeekendRepository(place.db, { rulesVersion: NEW }).sessionOf(key) as StoredSessionRow;
    await stale.rebuild(row);

    expect(factsWithRowids(place.db, key)).toEqual(before);
    expect(rowOf(place.db, key)).toMatchObject({ rules_version: OLD, complete: 0 });
  });

  it('the same session, once no feed runs it, is rebuilt and complete (the provider is read at every check)', async () => {
    const place = newPlace();
    const { key } = await storeSegment(place, SEGMENT, OLD);
    place.db.prepare('UPDATE sessions SET complete = 0 WHERE session_uid = ? AND weekend_id = ? AND player_car = ?').run(key.sessionUid, key.weekendId, key.playerCar);
    const running: SessionKey[] = [key];
    const { io } = quietIo();
    const stale = new StaleSessions(place.db, effectiveConfig(FEATURES), io, NEW, { running: () => running });
    closing.push(() => stale.close());
    running.splice(0);

    const row = new WeekendRepository(place.db, { rulesVersion: NEW }).sessionOf(key) as StoredSessionRow;
    await stale.rebuild(row);

    expect(rowOf(place.db, key)).toMatchObject({ rules_version: NEW, complete: 1 });
  });
});
