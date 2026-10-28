import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, SchemaVersionError, openDatabase } from '../../src/storage/db.ts';
const file = () => join(mkdtempSync(join(tmpdir(), 'db-')), 'pitwall.db');

describe('openDatabase', () => {
  it('creates the schema at version 1 with foreign keys on', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all())
      .toEqual(['drivers', 'events', 'flag_phases', 'laps', 'pit_stops', 'sessions', 'stints', 'weekends']);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare("SELECT name FROM pragma_table_info('laps') WHERE pk > 0 ORDER BY pk").pluck().all()).toEqual(['session_uid', 'car_id', 'lap_number']);
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
    try { openDatabase(path); } catch (e) { expect(e).toMatchObject({ found: version, expected: 1 }); }
  });
});
