import Database from 'better-sqlite3';
import type { CarId, DriverKey, SessionUid } from '@pitwall/domain';

export type Db = Database.Database;

export const SCHEMA_VERSION = 2;

/** Every per-session table refers to its session by both key columns. */
const SESSION_REF = `session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL`;
const SESSION_FK = `FOREIGN KEY (session_uid, weekend_id) REFERENCES sessions(session_uid, weekend_id)`;

const DDL = `
CREATE TABLE weekends (weekend_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, track_id INTEGER NOT NULL) STRICT;
/*
 * Keyed by session uid + weekend id: the game reuses a session uid across online weekends. One feed per key, so two
 * feeds of the same session (a second car) cannot be stored side by side yet.
 */
CREATE TABLE sessions (
  session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL REFERENCES weekends(weekend_id),
  session_type INTEGER NOT NULL, track_id INTEGER NOT NULL, started_at TEXT NOT NULL,
  pwrec_path TEXT, settings TEXT NOT NULL /* JSON */, PRIMARY KEY (session_uid, weekend_id)) STRICT;
CREATE INDEX sessions_by_weekend ON sessions (weekend_id, started_at);
CREATE TABLE drivers (
  ${SESSION_REF}, car_id INTEGER NOT NULL, driver_key TEXT NOT NULL /* driverKeyString */, key_json TEXT NOT NULL,
  PRIMARY KEY (session_uid, weekend_id, car_id), ${SESSION_FK}) STRICT;
CREATE INDEX drivers_by_key ON drivers (driver_key);
CREATE TABLE laps (
  ${SESSION_REF}, car_id INTEGER NOT NULL, lap_number INTEGER NOT NULL, lap_time_ms INTEGER NOT NULL,
  record TEXT NOT NULL /* JSON LapRecord */, PRIMARY KEY (session_uid, weekend_id, car_id, lap_number), ${SESSION_FK}) STRICT;
CREATE TABLE stints (${SESSION_REF}, seq INTEGER NOT NULL /* index in History.stints */,
  car_id INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (session_uid, weekend_id, seq), ${SESSION_FK}) STRICT;
CREATE TABLE pit_stops (${SESSION_REF}, seq INTEGER NOT NULL,
  car_id INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (session_uid, weekend_id, seq), ${SESSION_FK}) STRICT;
CREATE TABLE flag_phases (${SESSION_REF}, seq INTEGER NOT NULL,
  record TEXT NOT NULL, PRIMARY KEY (session_uid, weekend_id, seq), ${SESSION_FK}) STRICT;
CREATE TABLE events (${SESSION_REF}, seq INTEGER NOT NULL,
  car_id INTEGER, record TEXT NOT NULL, PRIMARY KEY (session_uid, weekend_id, seq), ${SESSION_FK}) STRICT;
`;

/** A stored session: the game reuses session uids across weekends, so the uid alone is no key. */
export type SessionKey = { sessionUid: SessionUid; weekendId: string };

export type SessionRow = {
  sessionUid: SessionUid;
  /** Decimal `weekendLinkIdentifier`. */
  weekendId: string;
  /** Decimal `seasonLinkIdentifier`. */
  seasonId: string;
  sessionType: number;
  trackId: number;
  /** ISO 8601. */
  startedAt: string;
  pwrecPath: string | null;
  settings: Record<string, number>;
  drivers: ReadonlyArray<{ carId: CarId; driverKey: DriverKey }>;
};

export class SchemaVersionError extends Error {
  override readonly name = 'SchemaVersionError';
  readonly found: number;
  readonly expected: number;

  constructor(found: number, expected: number) {
    super(`database schema version ${found}, expected ${expected}`);
    this.found = found;
    this.expected = expected;
  }
}

/** Opens (creating it if empty) the pitwall database; a database of any other schema version is refused. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    if (path !== ':memory:') db.pragma('journal_mode = WAL');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version === 0 && !hasTables(db)) {
      db.transaction(() => {
        db.exec(DDL);
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
      })();
    } else if (version !== SCHEMA_VERSION) {
      throw new SchemaVersionError(version, SCHEMA_VERSION);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function hasTables(db: Db): boolean {
  return db.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().get() !== 0;
}
