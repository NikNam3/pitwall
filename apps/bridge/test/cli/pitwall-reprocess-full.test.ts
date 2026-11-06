// `pitwall reprocess` with no `--weekend` (M6-R, C24, C61): on a current schema it deletes nothing. It runs every
// recording into the open database, one `replaceLog` per session, so an interrupted run leaves every session it did
// not reach as it was, and a session whose recording is missing is kept. Only a database of an older schema, which
// cannot be read, is deleted and rebuilt from the recordings.
import { closeSync, copyFileSync, fstatSync, mkdtempSync, openSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, SCHEMA_VERSION } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { SEGMENT } from '../helpers/cli.ts';
import { car, keyOf, lap, log, session } from '../storage/records.ts';

/** Two recordings of two different sessions. */
const RECORDINGS = [SEGMENT, segmentPath('race-singapore-wet-flashback.pwrec.gz')];
const SESSIONS = 'SELECT session_uid, weekend_id, player_car, pwrec_path FROM sessions ORDER BY session_uid, weekend_id, player_car';
const FACTS = 'SELECT session_uid, weekend_id, player_car, list, seq, car_id, record FROM facts ORDER BY session_uid, weekend_id, player_car, list, seq';

function memoryIo(dir: string, signal: AbortSignal = new AbortController().signal) {
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: dir }, signal };
  return { io, out, err };
}

/** A data dir whose recordings were imported: a current schema-4 database holding one complete session per recording. */
async function imported() {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-reprocess-full-'));
  for (const file of RECORDINGS) expect(await main(['import', file], memoryIo(dir).io)).toBe(0);
  const dirs = dataDir({ PITWALL_DATA_DIR: dir });
  expect(read(dir, SESSIONS)).toHaveLength(RECORDINGS.length);
  return { dir, dirs };
}

const read = <T = Record<string, unknown>>(dir: string, sql: string): T[] => {
  const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
};
const write = (dir: string, sql: string, ...params: unknown[]): void => {
  const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
};

describe('pitwall reprocess (every recording) on a current schema', { timeout: 60_000 }, () => {
  it('a full reprocess on a current schema deletes no session and replaces each log', async () => {
    const { dir, dirs } = await imported();
    const sessions = read(dir, SESSIONS);
    const facts = read(dir, FACTS);
    // each session's log gains a stale row and an old rules version: the reprocess must replace both
    for (const s of read<{ session_uid: string; weekend_id: string; player_car: number }>(dir, SESSIONS)) {
      write(dir, "INSERT INTO facts (session_uid, weekend_id, player_car, list, seq, car_id, record) VALUES (?, ?, ?, 'events', 999999, NULL, '{\"stale\":true}')",
        s.session_uid, s.weekend_id, s.player_car);
    }
    write(dir, "UPDATE sessions SET rules_version = 'old'");
    // held open through the run: were the file deleted, its link count would drop to 0 and a new file take the path
    const held = openSync(dirs.dbPath, 'r');

    const { io, out } = memoryIo(dir);
    try {
      expect(await main(['reprocess'], io)).toBe(0);
      // the same database file, never deleted
      expect(fstatSync(held).nlink).toBe(1);
      expect(statSync(dirs.dbPath).ino).toBe(fstatSync(held).ino);
    } finally { closeSync(held); }
    expect(out.join('\n')).toContain(`reprocessed ${RECORDINGS.length} recordings`);
    expect(read(dir, SESSIONS)).toEqual(sessions);
    expect(read(dir, FACTS)).toEqual(facts);
    expect(read(dir, "SELECT count(*) AS n FROM sessions WHERE rules_version = 'old' OR complete = 0")).toEqual([{ n: 0 }]);
  });

  it('an interrupted full reprocess leaves the sessions it did not reach', async () => {
    const { dir } = await imported();
    const sessions = read(dir, 'SELECT * FROM sessions ORDER BY session_uid, weekend_id, player_car');
    const cars = read(dir, 'SELECT * FROM cars ORDER BY session_uid, weekend_id, player_car, car_id');
    const facts = read(dir, FACTS);
    // the signal is aborted before the first recording: the run reaches none
    const { io } = memoryIo(dir, AbortSignal.abort());
    expect(await main(['reprocess'], io)).toBe(130);
    expect(read(dir, 'SELECT * FROM sessions ORDER BY session_uid, weekend_id, player_car')).toEqual(sessions);
    expect(read(dir, 'SELECT * FROM cars ORDER BY session_uid, weekend_id, player_car, car_id')).toEqual(cars);
    expect(read(dir, FACTS)).toEqual(facts);
    // the database stays current: the next `live` serves it as it is
    expect(read(dir, 'PRAGMA user_version')).toEqual([{ user_version: SCHEMA_VERSION }]);
  });

  it('a session without a recording survives a full reprocess', async () => {
    const { dir, dirs } = await imported();
    // a session whose recording is gone (C24: never deleted; served or not under the stale rules, C61)
    const orphan = session('424242', { weekendId: '77', playerCar: car(0), pwrecPath: join(dir, 'gone.pwrec.gz') });
    const db = openDatabase(dirs.dbPath);
    try {
      const writer = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'old' });
      writer.upsertSession(orphan);
      writer.writeLog(keyOf(orphan), log({ laps: [lap(0, 1)] }));
      writer.complete(keyOf(orphan));
    } finally { db.close(); }
    const ofOrphan = (sql: string) => read(dir, `${sql} WHERE session_uid = '424242' AND weekend_id = '77'`);
    const row = ofOrphan('SELECT * FROM sessions');
    const facts = ofOrphan('SELECT list, seq, record FROM facts');
    expect(facts).toHaveLength(1);

    expect(await main(['reprocess'], memoryIo(dir).io)).toBe(0);
    expect(ofOrphan('SELECT * FROM sessions')).toEqual(row);
    expect(ofOrphan('SELECT list, seq, record FROM facts')).toEqual(facts);
    expect(read(dir, SESSIONS)).toHaveLength(RECORDINGS.length + 1);
  });
});

describe('pitwall reprocess (every recording) on an older schema', { timeout: 60_000 }, () => {
  it('a database of an older schema is still deleted and rebuilt from the recordings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pitwall-reprocess-old-'));
    const dirs = dataDir({ PITWALL_DATA_DIR: dir });
    copyFileSync(SEGMENT, join(dirs.recordings, basename(SEGMENT)));
    const old = new Database(dirs.dbPath);
    old.exec('CREATE TABLE sessions (session_uid TEXT, weekend_id TEXT, PRIMARY KEY (session_uid, weekend_id)); CREATE TABLE laps (x INTEGER)');
    old.pragma('user_version = 3');
    old.close();

    expect(await main(['reprocess'], memoryIo(dir).io)).toBe(0);
    expect(read(dir, 'PRAGMA user_version')).toEqual([{ user_version: SCHEMA_VERSION }]);
    expect(read(dir, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r['name'])).toEqual(['cars', 'facts', 'sessions', 'weekends']);
    expect(read(dir, SESSIONS)).toHaveLength(1);
  });

  // SP4.1a f34 (F3, C43, C60, C61): schema 5 stores the teammate the engine placed with each session row. A session
  // stored under schema 4 has none: its database is refused (`SchemaVersionError`) and rebuilt from the recordings, so
  // the rebuilt row carries the teammate, as a session stored now does.
  it('a session stored before the teammate field is rebuilt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pitwall-reprocess-schema4-'));
    const dirs = dataDir({ PITWALL_DATA_DIR: dir });
    copyFileSync(SEGMENT, join(dirs.recordings, basename(SEGMENT)));
    const old = new Database(dirs.dbPath);
    old.exec(`CREATE TABLE weekends (weekend_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, track_id INTEGER NOT NULL) STRICT;
      CREATE TABLE sessions (
        session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL REFERENCES weekends(weekend_id), player_car INTEGER NOT NULL,
        track_id INTEGER NOT NULL, started_at TEXT NOT NULL, pwrec_path TEXT, settings TEXT NOT NULL,
        rules_version TEXT NOT NULL, complete INTEGER NOT NULL, PRIMARY KEY (session_uid, weekend_id, player_car)) STRICT;`);
    old.prepare("INSERT INTO weekends VALUES ('W', 'S', 26)").run();
    old.prepare("INSERT INTO sessions VALUES ('13536157633115227668', 'W', 1, 26, '2026-10-27T20:00:00.000Z', ?, '{}', 'old', 1)").run(join(dirs.recordings, basename(SEGMENT)));
    old.pragma('user_version = 4');
    old.close();

    expect(await main(['reprocess'], memoryIo(dir).io)).toBe(0);
    expect(read(dir, 'PRAGMA user_version')).toEqual([{ user_version: SCHEMA_VERSION }]);
    const rebuilt = read<{ session_uid: string; teammate_car: number | null }>(dir, 'SELECT session_uid, teammate_car FROM sessions');
    expect(rebuilt.map((r) => r.session_uid)).toEqual(['13536157633115227668']);
    expect(rebuilt[0]?.teammate_car === null || Number.isInteger(rebuilt[0]?.teammate_car)).toBe(true);

    // The rebuilt row is the one a session stored now gets: an import of the same recording into a new database.
    const fresh = mkdtempSync(join(tmpdir(), 'pitwall-reprocess-fresh-'));
    expect(await main(['import', SEGMENT], memoryIo(fresh).io)).toBe(0);
    expect(read(dir, 'SELECT session_uid, weekend_id, player_car, teammate_car FROM sessions'))
      .toEqual(read(fresh, 'SELECT session_uid, weekend_id, player_car, teammate_car FROM sessions'));
  });
});
