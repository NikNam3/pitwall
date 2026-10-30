import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, SchemaVersionError, openDatabase } from '../../src/storage/db.ts';
const file = () => join(mkdtempSync(join(tmpdir(), 'db-')), 'pitwall.db');

describe('openDatabase', () => {
  it('creates the schema at the current version with foreign keys on, sessions keyed by uid and weekend', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all())
      .toEqual(['drivers', 'events', 'flag_phases', 'laps', 'pit_stops', 'sessions', 'stints', 'weekends']);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const key = (table: string) => db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`).pluck().all();
    expect(key('sessions')).toEqual(['session_uid', 'weekend_id']);
    expect(key('laps')).toEqual(['session_uid', 'weekend_id', 'car_id', 'lap_number']);
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
  it('refuses a version-1 database (sessions keyed by uid alone) with SchemaVersionError', () => {
    const path = file();
    const raw = new Database(path);
    raw.exec('CREATE TABLE sessions (session_uid TEXT PRIMARY KEY, weekend_id TEXT NOT NULL)');
    raw.pragma('user_version = 1');
    raw.close();
    expect(() => openDatabase(path)).toThrow(expect.objectContaining({ name: 'SchemaVersionError', found: 1, expected: SCHEMA_VERSION }));
  });
});
