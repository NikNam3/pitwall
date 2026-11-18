// SP4.3e Task 7d (C61; spec §4.3 item 3a "One writer, short transactions"): the rebuild's replay runs in the worker; the
// main thread, the database's only writer, writes the rebuilt log in short transactions (parts into staging rows, then
// one swap), so a live feed never waits on a long one. Target: while a rebuild of a ~1 MB segment runs, the main
// thread's longest synchronous storage write stays under 20 ms.
//
// Each transaction is timed by the injected writer probe (`rebuild-fixtures.ts`); the code under test reads no timer.
// The segment is race-mexico-blue (fixtures/index.json: 993 272 bytes, 11 s of a 20-car race), stored once by an earlier
// bridge under another rules version and made stale again before each pass. One warm pass, then the best of the timed
// passes counts, so machine load cannot flake it (docs/testing.md 6). Run alone: `pnpm test:budget <this file>`.
import { describe, expect, it } from 'vitest';
import { createRebuildService } from '../../src/storage/rebuild-service.ts';
import { markStale, NEW, newPlace, OLD, probe, rowOf, sameKey, silent, storeSegment } from './rebuild-fixtures.ts';

const SEGMENT = 'race-mexico-blue.pwrec.gz';
const PASSES = 3;
const TARGET_MS = 20;

describe('rebuild service budget', () => {
  it(`${SEGMENT}: the main thread's longest storage write during its rebuild stays under ${TARGET_MS} ms (best of ${PASSES} warm passes)`, { timeout: 300_000 }, async () => {
    const place = newPlace();
    const { key } = await storeSegment(place, SEGMENT, OLD);
    const longest: number[] = [];
    for (let pass = 0; pass <= PASSES; pass++) {
      markStale(place.db, key);
      const { calls, writeProbe } = probe();
      const service = createRebuildService({ db: place.db, dataDir: place.dirs, rulesVersion: NEW, log: silent, writeProbe });
      try {
        await service.ensureCurrent([key]);
      } finally {
        await service.close();
      }
      const own = calls.filter((c) => sameKey(c.session, key));
      // the rebuild wrote its log through the probe: parts, then one swap
      expect(own.filter((c) => c.step === 'part').length).toBeGreaterThan(0);
      expect(own.filter((c) => c.step === 'swap')).toHaveLength(1);
      expect(rowOf(place.db, key)).toMatchObject({ rules_version: NEW, complete: 1 });
      if (pass > 0) longest.push(Math.max(...calls.map((c) => c.ms)));
    }
    expect(Math.min(...longest)).toBeLessThan(TARGET_MS);
  });
});
