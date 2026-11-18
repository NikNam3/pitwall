// SP4.3e Task 7d (C24, C60, C61; spec §4.3 item 3a "One writer, short transactions"): the rebuild service's worker only
// replays; the main thread writes the rebuilt log in parts into the session's staging rows and then swaps the session's
// log in one transaction, so the cached log is replaced as a whole. A reader during the rebuild (here: between the parts,
// from the writer probe, `rebuild-fixtures.ts`) sees the old log; after the swap, the new one.
//
// The stored session is the committed segment race-zandvoort-lap10 (fixtures/index.json: 5 s of a 20-car race, OVTK x2),
// stored by an earlier bridge under another rules version, its log then cut (its events removed) so the old log and the
// rebuilt one differ. The reader is a repository without a rules version: it serves any complete session (C61).
import { afterEach, describe, expect, it } from 'vitest';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { createRebuildService } from '../../src/storage/rebuild-service.ts';
import type { RebuildService } from '../../src/storage/rebuild-service-types.ts';
import { factRows } from './records.ts';
import { NEW, newPlace, OLD, probe, rowOf, sameKey, silent, storeSegment } from './rebuild-fixtures.ts';

const SEGMENT = 'race-zandvoort-lap10.pwrec.gz';

const services: RebuildService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
});

describe('the rebuild service replaces a stale session\'s log as a whole (C24, C61)', { timeout: 120_000 }, () => {
  it('ensureCurrent of a stale session replaces its log as a whole; a reader during the rebuild sees the old log, after it the new one', async () => {
    const place = newPlace();
    const { key } = await storeSegment(place, SEGMENT, OLD);
    // the log a rebuild from the recording gives (C38): the one the earlier bridge stored
    const whole = factRows(place.db, key);
    expect(whole.some((row) => row.list === 'events')).toBe(true);
    // the old log: the same, without its events
    place.db.prepare("DELETE FROM facts WHERE session_uid = ? AND weekend_id = ? AND player_car = ? AND list = 'events'").run(key.sessionUid, key.weekendId, key.playerCar);
    const reader = new WeekendRepository(place.db);
    const old = await reader.projectionOf(key);
    expect(old?.events).toEqual([]);
    const oldRows = factRows(place.db, key);

    const during: unknown[] = [];
    const after: unknown[] = [];
    const { calls, writeProbe } = probe((call) => {
      if (!sameKey(call.session, key)) return;
      // synchronous, between the service's transactions: what any reader of storage sees at this moment
      const seen = { rows: factRows(place.db, key), projection: reader.projectionOf(key) };
      (call.step === 'part' ? during : after).push(seen);
    });
    const service = createRebuildService({ db: place.db, dataDir: place.dirs, rulesVersion: NEW, log: silent, writeProbe });
    services.push(service);
    await service.ensureCurrent([key]);

    // at least one part was written before the swap, and the session's log was swapped exactly once
    expect(calls.filter((c) => sameKey(c.session, key) && c.step === 'part').length).toBeGreaterThan(0);
    expect(calls.filter((c) => sameKey(c.session, key) && c.step === 'swap')).toHaveLength(1);
    expect(calls.at(-1)?.step).toBe('swap');
    // during the rebuild: the old log, row for row, and the old projection
    for (const seen of during as Array<{ rows: unknown; projection: Promise<unknown> }>) {
      expect(seen.rows).toEqual(oldRows);
      expect(await seen.projection).toEqual(old);
    }
    // after the swap: the new log, whole, nothing of the old one or of the staging left
    const [swapped] = after as Array<{ rows: unknown; projection: Promise<unknown> }>;
    expect(swapped?.rows).toEqual(whole);
    expect(factRows(place.db, key)).toEqual(whole);
    const rebuilt = await reader.projectionOf(key);
    expect(rebuilt?.events.length).toBeGreaterThan(0);
    expect(await swapped?.projection).toEqual(rebuilt);
    expect(rowOf(place.db, key)).toMatchObject({ rules_version: NEW, complete: 1 });
  });
});
