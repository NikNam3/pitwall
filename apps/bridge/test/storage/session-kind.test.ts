// SP4.3e Task 7d round 2, ruling R9 (C24, C60, C61, C62): a session's weekend-phase kind on its row. The preselection
// (Task 7a-1) needs each stored session's kind also while the session is stale, when its projection must not be read
// before its rebuild (C61); so storage keeps it as row metadata, like the slots' team and race number (C62):
// `SessionRow.kind` (`WeekendPhaseKind | 'none'`: the weekend-phase span's kind, `'none'` while pending or without one).
//
// The live writer writes it once the weekend phase is decided; a rebuild writes it with the swapped log. Schema 6 → 7
// migrates in place: `ALTER TABLE sessions ADD COLUMN kind`, backfilled from each session's stored weekend-phase span
// (the first span's kind; `'none'` without one), every stored session kept (the user's stored sessions must survive).
//
// Temporary data dirs only (C84); the live sessions are builder packets, the rebuilt one a committed segment.
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeedId, SessionUid } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, SCHEMA_VERSION, type Db, type SessionKey } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { ArraySource } from '../helpers/array-source.ts';
import { newPlace, OLD, silent, storeSegment } from './rebuild-fixtures.ts';
import { car, key, keyOf, lap, log, session, slot, span, FERRARI_16, MERCEDES_44 } from './records.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'session-kind-')), 'pitwall.db');

/** Schema 6 as `db.ts` created it at 5eb17cda: the session row without its kind. */
const SCHEMA_6 = `
CREATE TABLE weekends (weekend_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, track_id INTEGER NOT NULL) STRICT;
CREATE TABLE sessions (
  session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL REFERENCES weekends(weekend_id), player_car INTEGER NOT NULL,
  teammate_car INTEGER, track_id INTEGER NOT NULL, started_at TEXT NOT NULL, pwrec_path TEXT, settings TEXT NOT NULL,
  rules_version TEXT NOT NULL, complete INTEGER NOT NULL, PRIMARY KEY (session_uid, weekend_id, player_car)) STRICT;
CREATE INDEX sessions_by_weekend ON sessions (weekend_id, started_at);
CREATE TABLE cars (
  session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL, player_car INTEGER NOT NULL, car_id INTEGER NOT NULL, team_id INTEGER NOT NULL,
  race_number INTEGER NOT NULL, name TEXT, PRIMARY KEY (session_uid, weekend_id, player_car, car_id),
  FOREIGN KEY (session_uid, weekend_id, player_car) REFERENCES sessions(session_uid, weekend_id, player_car)) STRICT;
CREATE INDEX cars_by_key ON cars (team_id, race_number);
CREATE TABLE facts (
  session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL, player_car INTEGER NOT NULL, list TEXT NOT NULL, seq INTEGER NOT NULL, car_id INTEGER,
  record TEXT NOT NULL, PRIMARY KEY (session_uid, weekend_id, player_car, list, seq),
  FOREIGN KEY (session_uid, weekend_id, player_car) REFERENCES sessions(session_uid, weekend_id, player_car)) STRICT;
`;

/** Every row of `tables`, rowids included, ordered by rowid. */
const rowsOf = (db: Database.Database, tables: readonly string[]) =>
  Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT rowid, * FROM ${t} ORDER BY rowid`).all()]));

/** The kind column of every session row, by session uid. */
const kinds = (db: Database.Database) =>
  Object.fromEntries((db.prepare('SELECT session_uid, kind FROM sessions ORDER BY session_uid').all() as Array<{ session_uid: string; kind: string }>).map((r) => [r.session_uid, r.kind]));

/**
 * A schema-6 database as the user's bridge left it: weekend W1 with session P (a practice: its weekend-phase span and a
 * lap, stale under an earlier rules version), session X (no weekend-phase span: stopped while pending, not complete) and
 * session T (a time trial: weekend-phase span `none`).
 */
function schema6Database(path: string): void {
  const raw = new Database(path);
  raw.exec(SCHEMA_6);
  raw.prepare("INSERT INTO weekends VALUES ('W1', 'S1', 26)").run();
  const insertSession = raw.prepare(`INSERT INTO sessions VALUES (?, 'W1', 1, NULL, 26, ?, ?, '{"tyreTemperature":1}', ?, ?)`);
  insertSession.run('P', '2026-10-27T20:00:00.000Z', '/rec/P.pwrec.gz', 'old-rules', 1);
  insertSession.run('X', '2026-10-27T21:00:00.000Z', '/rec/X.pwrec.gz', 'current', 0);
  insertSession.run('T', '2026-10-27T22:00:00.000Z', null, 'current', 1);
  const insertCar = raw.prepare("INSERT INTO cars VALUES (?, 'W1', 1, ?, ?, ?, ?)");
  for (const uid of ['P', 'X', 'T']) {
    insertCar.run(uid, 0, MERCEDES_44.teamId, MERCEDES_44.raceNumber, 'Driver Zero');
    insertCar.run(uid, 1, FERRARI_16.teamId, FERRARI_16.raceNumber, null);
  }
  const insertFact = raw.prepare("INSERT INTO facts VALUES (?, 'W1', 1, ?, ?, ?, ?)");
  insertFact.run('P', 'laps', 0, 1, JSON.stringify(lap(1, 1)));
  insertFact.run('P', 'spans:weekend-phase', 0, null, JSON.stringify(span('weekend-phase', 'practice', { detail: { format: 'practice', segment: 1 } })));
  insertFact.run('X', 'laps', 0, 1, JSON.stringify(lap(1, 1)));
  insertFact.run('X', 'laps', 1, 1, JSON.stringify(lap(1, 2)));
  insertFact.run('T', 'spans:weekend-phase', 0, null, JSON.stringify(span('weekend-phase', 'none')));
  raw.pragma('user_version = 6');
  raw.close();
}

describe('schema 6 → 7: a session\'s kind on its row, migrated in place (R9, C60, C61, C62)', () => {
  it('a version-6 database with a practice session and one without a weekend-phase span opens as version 7 with kinds practice and none, every fact kept', () => {
    const path = file();
    schema6Database(path);
    const raw = new Database(path, { readonly: true });
    const before = rowsOf(raw, ['weekends', 'sessions', 'cars', 'facts']);
    raw.close();

    const db = openDatabase(path);
    expect(SCHEMA_VERSION).toBe(7);
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    // backfilled from each session's first weekend-phase span; none without one
    expect(kinds(db)).toEqual({ P: 'practice', T: 'none', X: 'none' });
    // every stored session, car and fact kept as it was: same rows, same rowids, the old columns' values unchanged
    const after = rowsOf(db, ['weekends', 'sessions', 'cars', 'facts']);
    expect(after['weekends']).toEqual(before['weekends']);
    expect(after['cars']).toEqual(before['cars']);
    expect(after['facts']).toEqual(before['facts']);
    expect((after['sessions'] as Array<Record<string, unknown>>).map(({ kind: _kind, ...rest }) => rest)).toEqual(before['sessions']);
    // the stale session's kind is read from its row (its log is not read before its rebuild, C61)
    const repo = new WeekendRepository(db, { rulesVersion: 'current' });
    expect(repo.sessionOf(key('P'))).toMatchObject({ kind: 'practice', rulesVersion: 'old-rules', complete: true });
    expect(repo.sessionOf(key('X'))).toMatchObject({ kind: 'none', complete: false });
    db.close();
  });

  it('a migrated database reopens as version 7 without a second migration, its kinds unchanged', () => {
    const path = file();
    schema6Database(path);
    openDatabase(path).close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    expect(kinds(db)).toEqual({ P: 'practice', T: 'none', X: 'none' });
    expect(db.prepare("SELECT count(*) FROM pragma_table_info('sessions') WHERE name = 'kind'").pluck().get()).toBe(1);
    db.close();
  });

  it('a new database\'s session rows have the kind column too: a written row reads back its kind', () => {
    const db = openDatabase(':memory:');
    new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'current' }).upsertSession(session('Q', { kind: 'qualifying' }));
    expect(kinds(db)).toEqual({ Q: 'qualifying' });
  });
});

describe('StoredSessionRow reads carry kind (R9, C62)', () => {
  it('sessionOf, sessionsOf, incompleteSessions, staleSessionsOf and sessionsOnTrack carry each row\'s kind, a stale session\'s too', () => {
    const db = openDatabase(':memory:');
    const writer = (rulesVersion: string) => new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion });
    const current = writer('current'), old = writer('old');
    const practice = session('1', { kind: 'practice', startedAt: '2026-10-27T18:00:00.000Z' });
    const qualifying = session('2', { kind: 'qualifying', startedAt: '2026-10-27T19:00:00.000Z' });
    const race = session('3', { kind: 'race', startedAt: '2026-10-27T20:00:00.000Z' });
    const pending = session('4', { startedAt: '2026-10-27T21:00:00.000Z' });
    // a stale practice: complete under an earlier rules version, its log holding no weekend-phase span (the row is read)
    old.upsertSession(practice);
    old.complete(keyOf(practice));
    for (const row of [qualifying, race]) {
      current.upsertSession(row);
      current.complete(keyOf(row));
    }
    current.upsertSession(pending);

    const repo = new WeekendRepository(db, { rulesVersion: 'current' });
    expect(repo.sessionOf(keyOf(practice))?.kind).toBe('practice');
    expect(repo.sessionOf(keyOf(race))?.kind).toBe('race');
    expect(repo.sessionsOf('W1').map((s) => [s.sessionUid, s.kind])).toEqual([['1', 'practice'], ['2', 'qualifying'], ['3', 'race'], ['4', 'none']]);
    expect(repo.incompleteSessions().map((s) => [s.sessionUid, s.kind])).toEqual([['4', 'none']]);
    expect(repo.staleSessionsOf('W1').map((s) => [s.sessionUid, s.kind])).toEqual(expect.arrayContaining([['1', 'practice']]));
    expect(repo.sessionsOnTrack(26).map((s) => [s.sessionUid, s.stale, s.kind])).toEqual([['1', true, 'practice'], ['2', false, 'qualifying'], ['3', false, 'race']]);
  });
});

describe('the live writer writes a session\'s kind once its weekend phase is decided (R9)', () => {
  it('a row first written with kind none gets its kind when it is written again with the decided weekend phase', () => {
    const db = openDatabase(':memory:');
    const writer = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'current' });
    const row = session('1', { cars: [slot(0, MERCEDES_44), slot(1, FERRARI_16)] });
    writer.startSession(row, { continued: false });
    expect(kinds(db)).toEqual({ 1: 'none' });
    writer.upsertSession({ ...row, kind: 'race' });
    expect(kinds(db)).toEqual({ 1: 'race' });
    expect(new WeekendRepository(db).sessionOf(keyOf(row))).toMatchObject({ kind: 'race', complete: false });
  });

  const F = 'live' as FeedId;
  const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
  /** A live session of builder packets with `session`'s type and weekend structure; no SEND unless `end`. */
  const packets = (uid: bigint, s: { sessionType: number; weekendStructure: number[] }, end: boolean) => {
    const b = new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session({ weekendLinkIdentifier: 7, ...s }).participants().frames(20, () => {});
    return (end ? b.event({ code: 'SEND' }) : b).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
  };
  async function live(uid: number, s: { sessionType: number; weekendStructure: number[] }, end: boolean): Promise<{ db: Db; key: SessionKey }> {
    const dirs = dataDir({ PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'session-kind-live-')) });
    const db = openDatabase(dirs.dbPath);
    const pipeline = new FeedPipeline({
      feedId: F, source: new ArraySource(F, packets(BigInt(uid), s, end)), hub: new TopicHub({ now: () => 0 }),
      features: FEATURES, log: silent, wallClock: () => T0, storage: { db, recordingsDir: dirs.recordings, rulesVersion: 'current' },
    });
    pipeline.start();
    await pipeline.done;
    return { db, key: { sessionUid: String(uid) as SessionUid, weekendId: '7', playerCar: car(0) } };
  }

  it.each([
    ['a practice', { sessionType: 1, weekendStructure: [1] }, 'practice'],
    ['a race', { sessionType: 15, weekendStructure: [15] }, 'race'],
    ['a time trial (weekend phase none)', { sessionType: 18, weekendStructure: [18] }, 'none'],
  ] as const)('%s live session\'s row gets its kind (%s) once the weekend phase is decided, also without its end', async (_name, s, kind) => {
    for (const end of [false, true]) {
      const { db, key: k } = await live(end ? 2 : 1, { sessionType: s.sessionType, weekendStructure: [...s.weekendStructure] }, end);
      try {
        expect(new WeekendRepository(db).sessionOf(k)?.kind).toBe(kind);
      } finally {
        db.close();
      }
    }
  }, 60_000);
});

// The rebuild service's swap writes the kind too: `rebuild-swap.test.ts`.
describe('a rebuild writes the kind with the swapped log (R9, C24, C61)', () => {
  it('replaceLog writes the row\'s kind with the log', () => {
    const db = openDatabase(':memory:');
    const writer = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'old' });
    const row = session('1');
    writer.upsertSession(row);
    expect(kinds(db)).toEqual({ 1: 'none' });
    writer.replaceLog({ ...row, kind: 'qualifying' }, log({ spans: { 'weekend-phase': [span('weekend-phase', 'qualifying', { detail: { format: 'grandPrix', segment: 1 } })] } }), 'current');
    expect(kinds(db)).toEqual({ 1: 'qualifying' });
  });

  it('a session processed from its recording (reprocess, import) is stored with its kind', { timeout: 120_000 }, async () => {
    const place = newPlace();
    // race-zandvoort-lap10 (fixtures/index.json): 5 s of a race
    const { key: k } = await storeSegment(place, 'race-zandvoort-lap10.pwrec.gz', OLD);
    expect(new WeekendRepository(place.db).sessionOf(k)?.kind).toBe('race');
    place.db.close();
  });
});
