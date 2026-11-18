// SP4.3e Task 7d (C24, C58, C60, C61; spec §4.3 item 3a): the one rebuild service. `ensureCurrent(refs)` brings stored
// sessions to the current rules version before they are used, one session at a time, in a worker thread that only
// replays; a current session waits for nothing. A recording replayed to its end on which no session runs is complete,
// whether or not it ended by an end signal (C61 as changed). Ported from `test/cli/rules-version-rebuild.test.ts` (the
// startup rebuild, `StaleSessions.rebuildNewestWeekend`, deleted with this task): a session whose recording is missing
// is kept, never served, and warned about once; the progress is reported 0 of n first, then per session done.
//
// Every data dir and database is a temporary one (C84); the stored sessions are committed segments an earlier bridge
// stored (`rebuild-fixtures.ts`). Parts and swaps are observed through the injected writer probe.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionConfigPath } from '../../src/feature-config.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { createRebuildService } from '../../src/storage/rebuild-service.ts';
import type { RebuildService } from '../../src/storage/rebuild-service-types.ts';
import type { Db } from '../../src/storage/db.ts';
import type { DataDir } from '../../src/storage/data-dir.ts';
import type { Logger } from '../../src/log.ts';
import { factRows } from './records.ts';
import { capturedLog, dump, factsWithRowids, NEW, newPlace, OLD, probe, rowOf, sameKey, silent, storeSegment, type WriteProbe } from './rebuild-fixtures.ts';

/** A race cut mid-race (fixtures/index.json: car 1 in the pit lane after its stop): its recording holds no SEND. */
const NO_END = 'race-zandvoort-pit-exit.pwrec.gz';
/** A qualifying's last 1.6 s, SEND included. */
const QUALIFYING = 'qualifying-singapore-end.pwrec.gz';
/** A race's last 1.9 s, SEND included. */
const RACE_END = 'race-singapore-end.pwrec.gz';

const services: RebuildService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
});

function serviceOf(place: { dirs: DataDir; db: Db }, opts: { log?: Logger; writeProbe?: WriteProbe } = {}): RebuildService {
  const service = createRebuildService({ db: place.db, dataDir: place.dirs, rulesVersion: NEW, log: opts.log ?? silent, ...(opts.writeProbe && { writeProbe: opts.writeProbe }) });
  services.push(service);
  return service;
}

describe('ensureCurrent rebuilds a stale session once and a current one never (C61)', { timeout: 120_000 }, () => {
  it('two calls for the same session rebuild it once; a current session is not rebuilt', async () => {
    const place = newPlace();
    const stale = await storeSegment(place, NO_END, OLD);
    const current = await storeSegment(place, QUALIFYING, NEW);
    const log = factRows(place.db, stale.key);
    const currentFacts = factsWithRowids(place.db, current.key);
    const currentRow = rowOf(place.db, current.key);
    const { calls, writeProbe } = probe();
    const service = serviceOf(place, { writeProbe });

    await Promise.all([service.ensureCurrent([stale.key, current.key]), service.ensureCurrent([stale.key])]);
    expect(calls.filter((c) => sameKey(c.session, stale.key) && c.step === 'swap')).toHaveLength(1);
    expect(rowOf(place.db, stale.key)).toMatchObject({ rules_version: NEW, complete: 1 });
    // the same recording gives the same log (C38)
    expect(factRows(place.db, stale.key)).toEqual(log);
    // once current, it waits for nothing
    await service.ensureCurrent([stale.key]);
    expect(calls.filter((c) => sameKey(c.session, stale.key) && c.step === 'swap')).toHaveLength(1);
    // the current session: no write at all, its rows as they were
    expect(calls.filter((c) => sameKey(c.session, current.key))).toEqual([]);
    expect(factsWithRowids(place.db, current.key)).toEqual(currentFacts);
    expect(rowOf(place.db, current.key)).toEqual(currentRow);
  });

  it('ensureCurrent of current sessions only writes nothing', async () => {
    const place = newPlace();
    const a = await storeSegment(place, QUALIFYING, NEW);
    const b = await storeSegment(place, RACE_END, NEW);
    const before = dump(place.db);
    const { calls, writeProbe } = probe();
    await serviceOf(place, { writeProbe }).ensureCurrent([a.key, b.key]);
    expect(calls).toEqual([]);
    expect(dump(place.db)).toEqual(before);
  });

  it('reports 0 of n before the first session, then each session done', async () => {
    const place = newPlace();
    const a = await storeSegment(place, NO_END, OLD);
    const b = await storeSegment(place, QUALIFYING, OLD);
    const progress: Array<[number, number]> = [];
    await serviceOf(place).ensureCurrent([a.key, b.key], { onProgress: (done, total) => progress.push([done, total]) });
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  });
});

describe('the complete rule (C61 as changed): replayed to its end with no session running on it', { timeout: 120_000 }, () => {
  it.each([
    ['another rules version', OLD],
    ['this rules version, its log not complete', NEW],
  ])('a recording replayed to its end with no running session is complete after the rebuild, without an end signal (%s)', async (_name, version) => {
    const place = newPlace();
    const session = await storeSegment(place, NO_END, version);
    // as a bridge stopped mid-session left it: never marked complete
    place.db.prepare('UPDATE sessions SET complete = 0').run();
    await serviceOf(place).ensureCurrent([session.key]);
    expect(rowOf(place.db, session.key)).toMatchObject({ rules_version: NEW, complete: 1, pwrec_path: session.file });
    // and served from now on
    const projection = await new WeekendRepository(place.db, { rulesVersion: NEW }).projectionOf(session.key);
    expect(projection).toBeDefined();
  });
});

describe('a session that cannot be rebuilt is kept (C24) and warned about once (ported)', { timeout: 120_000 }, () => {
  it('a session whose recording is missing is kept and not served, and warned about once', async () => {
    const place = newPlace();
    const gone = await storeSegment(place, NO_END, OLD);
    rmSync(gone.file);
    rmSync(sessionConfigPath(gone.file), { force: true });
    const facts = factsWithRowids(place.db, gone.key);
    const row = rowOf(place.db, gone.key);
    const { log, records } = capturedLog('warn');
    const service = serviceOf(place, { log });
    // the caller does without it (C61): ensureCurrent resolves, the session stays stale
    await service.ensureCurrent([gone.key]);
    await service.ensureCurrent([gone.key]);
    expect(records.filter((r) => r['sessionUid'] === gone.key.sessionUid)).toHaveLength(1);
    expect(rowOf(place.db, gone.key)).toEqual(row);
    expect(factsWithRowids(place.db, gone.key)).toEqual(facts);
    expect(await new WeekendRepository(place.db, { rulesVersion: NEW }).projectionOf(gone.key)).toBeUndefined();
  });
});

describe('replayToEnd: the planning replay in the same worker (C62d; its planning result is Task 7b\'s)', { timeout: 120_000 }, () => {
  it('replays a recording to its end and stores nothing', async () => {
    const place = newPlace();
    const qualifying = await storeSegment(place, QUALIFYING, NEW);
    const before = dump(place.db);
    const { calls, writeProbe } = probe();
    const service = serviceOf(place, { writeProbe });
    await service.replayToEnd<unknown>({ pwrecPath: qualifying.file, basisOverride: [], laps: 20, sets: 'carried' }, 'planning');
    expect(calls).toEqual([]);
    expect(dump(place.db)).toEqual(before);
  });
});
