import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, SchemaVersionError, openDatabase } from '../../src/storage/db.ts';
const file = () => join(mkdtempSync(join(tmpdir(), 'db-')), 'pitwall.db');

describe('openDatabase', () => {
  // Task 27 (C24, C60, C1a): schema 4 holds each session's log in generic tables, keyed per feed by the player car
  it('creates schema 4: weekends, sessions, cars and facts, with foreign keys on', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all())
      .toEqual(['cars', 'facts', 'sessions', 'weekends']);
    expect(SCHEMA_VERSION).toBe(4);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
  it('keys a session by uid, weekend and the feed\'s player car; its cars and facts by that key', () => {
    const db = openDatabase(':memory:');
    const key = (table: string) => db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`).pluck().all();
    expect(key('weekends')).toEqual(['weekend_id']);
    expect(key('sessions')).toEqual(['session_uid', 'weekend_id', 'player_car']);
    expect(key('cars')).toEqual(['session_uid', 'weekend_id', 'player_car', 'car_id']);
    expect(key('facts')).toEqual(['session_uid', 'weekend_id', 'player_car', 'list', 'seq']);
  });
  it('the session row holds the recording\'s values, the player car, the rules version and complete; no weekend phase, no drivers', () => {
    const db = openDatabase(':memory:');
    const columns = (table: string) => db.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).pluck().all();
    expect(columns('sessions')).toEqual(['session_uid', 'weekend_id', 'player_car', 'track_id', 'started_at', 'pwrec_path', 'settings', 'rules_version', 'complete']);
    expect(columns('cars')).toEqual(['session_uid', 'weekend_id', 'player_car', 'car_id', 'team_id', 'race_number']);
    expect(columns('facts')).toEqual(['session_uid', 'weekend_id', 'player_car', 'list', 'seq', 'car_id', 'record']);
    expect(columns('weekends')).toEqual(['weekend_id', 'season_id', 'track_id']);
  });
  it('indexes the cars by team and race number (C62)', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare("SELECT name FROM pragma_index_info('cars_by_key') ORDER BY seqno").pluck().all()).toEqual(['team_id', 'race_number']);
  });
  it('reopens an existing database', () => {
    const path = file();
    openDatabase(path).close();
    expect(() => openDatabase(path).close()).not.toThrow();
  });
  it.each([[7, ''], [0, 'CREATE TABLE foreign_table (x INTEGER)']])('throws SchemaVersionError for version %i', (version, ddl) => {
    const path = file();
    const raw = new Database(path);
    if (ddl) raw.exec(ddl);
    raw.pragma(`user_version = ${version}`);
    raw.close();
    expect(() => openDatabase(path)).toThrow(SchemaVersionError);
    try { openDatabase(path); } catch (e) { expect(e).toMatchObject({ found: version, expected: SCHEMA_VERSION }); }
  });
  it.each([2, 3])('refuses a schema-%i database (the per-list tables) with SchemaVersionError, so `live` rebuilds it', (version) => {
    const path = file();
    const raw = new Database(path);
    raw.exec('CREATE TABLE sessions (session_uid TEXT, weekend_id TEXT, PRIMARY KEY (session_uid, weekend_id)); CREATE TABLE laps (x INTEGER)');
    raw.pragma(`user_version = ${version}`);
    raw.close();
    expect(() => openDatabase(path)).toThrow(expect.objectContaining({ name: 'SchemaVersionError', found: version, expected: SCHEMA_VERSION }));
  });
  it('refuses a version-1 database (sessions keyed by uid alone) with SchemaVersionError', () => {
    const path = file();
    const raw = new Database(path);
    raw.exec('CREATE TABLE sessions (session_uid TEXT PRIMARY KEY, weekend_id TEXT NOT NULL)');
    raw.pragma('user_version = 1');
    raw.close();
    expect(() => openDatabase(path)).toThrow(expect.objectContaining({ name: 'SchemaVersionError', found: 1, expected: SCHEMA_VERSION }));
  });
});
