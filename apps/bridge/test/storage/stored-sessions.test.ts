// SP4.3f Task 1 (C61, C62; spec §4.2 "The stored-sessions topic"): `WeekendRepository.storedSessions()` gives every
// complete stored row of kind `practice` or `qualifying`, in start order, with its cars, from the rows alone: no log
// is read, so a stale session (another rules version) is listed without reading its facts (C61), and nothing is
// rebuilt. An incomplete session (its run still going, C59) is left out, and so is a race.
//
// Seam this file assumes (the implement phase adds it): `WeekendRepository.storedSessions(): StoredSessionRow[]`.
//
// The data dir and database are fresh temporary ones (C84); the sessions are synthetic recordings
// (`test-support/recordings`) processed into it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUid } from '@pitwall/domain';
import { processRecording } from '../../src/cli/process-recording.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { createLogger } from '../../src/log.ts';
import { dataDir, type DataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { writeSynthetic, type SyntheticSession } from '../../../../test-support/recordings/index.ts';
import { car, keyOf, log, session, slot } from './records.ts';

const RULES = 'rules-of-this-bridge';
const OLD_RULES = 'rules-of-an-older-bridge';
const TEXAS = 15;
const WEEKEND = 548397152;
const silent = createLogger({ level: 'silent' });

/** Four cars: two of team 5, then team 0's #64 and #2; the player is #2 in slot 3. */
const CARS: SyntheticSession['cars'] = [
  { teamId: 5, raceNumber: 10 },
  { teamId: 5, raceNumber: 11 },
  { teamId: 0, raceNumber: 64, name: 'ASYMETRISCH' },
  { teamId: 0, raceNumber: 2, name: 'DR' },
];

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/** A fresh data dir (C84) and its database. */
function newPlace(): { dirs: DataDir; db: Db } {
  const dirs = dataDir({ PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-stored-sessions-')) });
  const db = openDatabase(dirs.dbPath);
  cleanup.push(() => db.close());
  return { dirs, db };
}

/** A synthetic session of the Texas weekend written into the place's recordings and processed under `rules`. */
async function store(place: { dirs: DataDir; db: Db }, uid: bigint, kind: SyntheticSession['kind'], rules = RULES): Promise<void> {
  const file = join(place.dirs.recordings, `${kind}-${uid}.pwrec.gz`);
  await writeSynthetic(file, { sessionUid: uid, weekendId: WEEKEND, trackId: TEXAS, kind, player: 3, cars: CARS, laps: 1 });
  await processRecording(file, place.db, silent, new AbortController().signal, loadFeatureConfig(place.dirs.root, FEATURES), rules);
}

/**
 * Wraps the database's `prepare` before a repository is made, so every statement that reads the `facts` table is
 * spied on: the test sees whether a log was read.
 */
function spyOnFactReads(db: Db): { reads: () => number } {
  const prepare = db.prepare.bind(db);
  const spies: Array<{ mock: { calls: unknown[] } }> = [];
  vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (/\bFROM\s+facts\b/i.test(sql)) {
      for (const method of ['all', 'get', 'iterate', 'raw', 'pluck'] as const) spies.push(vi.spyOn(statement, method as 'all'));
    }
    return statement;
  }) as Db['prepare']);
  return { reads: () => spies.reduce((n, s) => n + s.mock.calls.length, 0) };
}

describe('WeekendRepository.storedSessions (C61, C62)', () => {
  it('lists the complete practice and qualifying rows in start order with their cars; a race is not listed', async () => {
    const place = newPlace();
    await store(place, 1n, 'practice');
    await store(place, 2n, 'qualifying');
    await store(place, 3n, 'race');
    const rows = new WeekendRepository(place.db, { rulesVersion: RULES }).storedSessions();
    expect(rows.map((r) => [r.sessionUid, r.kind])).toEqual([['1', 'practice'], ['2', 'qualifying']]);
    for (const r of rows) {
      expect(r).toMatchObject({ weekendId: String(WEEKEND), trackId: TEXAS, playerCar: car(3), complete: true, rulesVersion: RULES });
      expect(r.cars.map((c) => [c.carId, c.carKey])).toEqual([
        [0, { teamId: 5, raceNumber: 10 }],
        [1, { teamId: 5, raceNumber: 11 }],
        [2, { teamId: 0, raceNumber: 64 }],
        [3, { teamId: 0, raceNumber: 2 }],
      ]);
    }
  });

  it('an incomplete session is left out', async () => {
    const place = newPlace();
    await store(place, 1n, 'practice');
    // A qualifying whose run is still going: its row and log written, never completed (C59).
    const writer = new StorageWriter(place.db, { onError: (e) => { throw e; }, rulesVersion: RULES });
    const running = session('9', { weekendId: String(WEEKEND), trackId: TEXAS, playerCar: car(1), kind: 'qualifying', cars: [slot(0, { teamId: 0, raceNumber: 64 }), slot(1, { teamId: 0, raceNumber: 2 })] });
    writer.upsertSession(running);
    writer.writeLog(keyOf(running), log());
    const rows = new WeekendRepository(place.db, { rulesVersion: RULES }).storedSessions();
    expect(rows.map((r) => r.sessionUid)).toEqual(['1' as SessionUid]);
  });

  it('a stale session is listed without reading its facts, and nothing is rebuilt', async () => {
    const place = newPlace();
    await store(place, 1n, 'practice', OLD_RULES);
    await store(place, 2n, 'qualifying');
    const facts = spyOnFactReads(place.db);
    const rebuild = vi.fn(async () => {});
    const repo = new WeekendRepository(place.db, { rulesVersion: RULES, rebuild });
    const rows = repo.storedSessions();
    expect(rows.map((r) => [r.sessionUid, r.rulesVersion])).toEqual([['1', OLD_RULES], ['2', RULES]]);
    expect(facts.reads()).toBe(0);
    expect(rebuild).not.toHaveBeenCalled();
    // The spy sees a read when there is one: the current qualifying's projection reads its facts.
    repo.sessionsOnTrack(TEXAS);
    expect(facts.reads()).toBeGreaterThan(0);
  });
});
