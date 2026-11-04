import Database from 'better-sqlite3';
import type { CarId, CarKey, SessionUid } from '@pitwall/domain';
import { SchemaVersionError } from './schema-version-error.ts';

export { SchemaVersionError };

export type Db = Database.Database;

export const SCHEMA_VERSION = 4;

/** The rules version every log is stored with until the computed one is wired (C61, Task 28). */
export const UNVERSIONED_RULES = 'unversioned';

/** Every per-session table refers to its session by the three key columns (C1a, C60). */
const SESSION_REF = `session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL, player_car INTEGER NOT NULL`;
const SESSION_FK = `FOREIGN KEY (session_uid, weekend_id, player_car) REFERENCES sessions(session_uid, weekend_id, player_car)`;

/**
 * Storage is a rebuildable cache of the logs (C60): each session's log as it is, in generic tables. `facts.list` is a
 * log list (`laps` … `clock`), `voids` or `spans:<machine>`, so a new sub-machine adds rows, not tables.
 */
const DDL = `
CREATE TABLE weekends (weekend_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, track_id INTEGER NOT NULL) STRICT;
/*
 * Keyed by session uid, weekend id and the feed's player car: the game reuses a session uid across online weekends, and
 * two feeds of one session are stored side by side (C1a). The row holds only values from the recording, the player
 * car, the rules version of its log and whether that log is complete (C32, C61).
 */
CREATE TABLE sessions (
  session_uid TEXT NOT NULL, weekend_id TEXT NOT NULL REFERENCES weekends(weekend_id), player_car INTEGER NOT NULL,
  track_id INTEGER NOT NULL, started_at TEXT NOT NULL, pwrec_path TEXT, settings TEXT NOT NULL /* JSON */,
  rules_version TEXT NOT NULL, complete INTEGER NOT NULL, PRIMARY KEY (session_uid, weekend_id, player_car)) STRICT;
CREATE INDEX sessions_by_weekend ON sessions (weekend_id, started_at);
/* Every slot's team and race number (C62), as the session's Participants last named them. */
CREATE TABLE cars (
  ${SESSION_REF}, car_id INTEGER NOT NULL, team_id INTEGER NOT NULL, race_number INTEGER NOT NULL,
  PRIMARY KEY (session_uid, weekend_id, player_car, car_id), ${SESSION_FK}) STRICT;
CREATE INDEX cars_by_key ON cars (team_id, race_number);
/* The log (C21, C24): one row per fact, by its list and its position in it; append-only. */
CREATE TABLE facts (
  ${SESSION_REF}, list TEXT NOT NULL, seq INTEGER NOT NULL /* position in the log list */, car_id INTEGER,
  record TEXT NOT NULL /* JSON */, PRIMARY KEY (session_uid, weekend_id, player_car, list, seq), ${SESSION_FK}) STRICT;
`;

/** A stored session (C1a, C60): the game reuses session uids across weekends, and a session has one log per feed. */
export type SessionKey = { sessionUid: SessionUid; weekendId: string; playerCar: CarId };

export type SessionRow = {
  sessionUid: SessionUid;
  /** Decimal `weekendLinkIdentifier`. */
  weekendId: string;
  /** Decimal `seasonLinkIdentifier`. */
  seasonId: string;
  /** The feed's player car: the player car index of the session's first frame. */
  playerCar: CarId;
  trackId: number;
  /** ISO 8601. */
  startedAt: string;
  pwrecPath: string | null;
  /** The game settings as the engine reads them (`GameSettings`). */
  settings: Record<string, string | number | boolean>;
  /** Every slot's team and race number (C62), ordered by car id when read. */
  cars: ReadonlyArray<{ carId: CarId; carKey: CarKey }>;
};

/** A row as storage returns it: with the rules version of its log and whether that log is complete (C61). */
export type StoredSessionRow = SessionRow & { rulesVersion: string; complete: boolean };

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
