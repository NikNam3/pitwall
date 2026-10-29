import { driverKeyString, type CarId, type DriverKey, type FlagPhase, type LapRecord, type PitStopRecord, type RaceEvent, type SessionUid, type StintRecord } from '@pitwall/domain';
import { unknownLapEnd, type WeekendContext } from '@pitwall/engine';
import type { Db, SessionRow } from './db.ts';

type SessionDbRow = {
  session_uid: string;
  weekend_id: string;
  season_id: string;
  session_type: number;
  track_id: number;
  started_at: string;
  pwrec_path: string | null;
  settings: string;
};

type DriverDbRow = { car_id: number; key_json: string };

/** Laps stored before the lap-end samples existed lack those fields: they read as `unknown('notReceived')`. */
const withLapEndSamples = (lap: LapRecord): LapRecord => ({ ...unknownLapEnd(), ...lap });

/** Read side of storage: sessions of a weekend and the history records stored for them, in write order. */
export class WeekendRepository {
  private readonly statements;

  constructor(db: Db) {
    const sessionColumns = `s.session_uid, s.weekend_id, w.season_id, s.session_type, s.track_id, s.started_at, s.pwrec_path, s.settings`;
    const sessionsFrom = `FROM sessions s JOIN weekends w ON w.weekend_id = s.weekend_id`;
    const byKey = (table: string, order: string) =>
      db
        .prepare(
          `SELECT t.record FROM ${table} t
           WHERE t.session_uid = @sessionUid
             AND (@driverKey IS NULL OR EXISTS (
               SELECT 1 FROM drivers d WHERE d.session_uid = t.session_uid AND d.car_id = t.car_id AND d.driver_key = @driverKey))
           ORDER BY ${order}`,
        )
        .pluck();
    const records = (table: string) => db.prepare(`SELECT record FROM ${table} WHERE session_uid = ? ORDER BY seq`).pluck();
    this.statements = {
      weekendSessions: db.prepare(`SELECT ${sessionColumns} ${sessionsFrom} WHERE s.weekend_id = ? ORDER BY s.started_at, s.session_uid`),
      weekendSessionsOfDriverBefore: db.prepare(
        `SELECT ${sessionColumns} ${sessionsFrom}
         WHERE s.weekend_id = @weekendId
           AND EXISTS (SELECT 1 FROM drivers d WHERE d.session_uid = s.session_uid AND d.driver_key = @driverKey)
           AND (@before IS NULL OR s.started_at < (SELECT started_at FROM sessions WHERE session_uid = @before))
         ORDER BY s.started_at, s.session_uid`,
      ),
      drivers: db.prepare('SELECT car_id, key_json FROM drivers WHERE session_uid = ? ORDER BY car_id'),
      laps: byKey('laps', 't.rowid'),
      stints: byKey('stints', 't.seq'),
      pitStops: byKey('pit_stops', 't.seq'),
      flagPhases: records('flag_phases'),
      events: records('events'),
    };
  }

  sessionsOf(weekendId: string): SessionRow[] {
    return (this.statements.weekendSessions.all(weekendId) as SessionDbRow[]).map((row) => this.toSession(row));
  }

  lapsOf(sessionUid: SessionUid, driverKey?: DriverKey): LapRecord[] {
    return this.read<LapRecord>(this.statements.laps, sessionUid, driverKey).map(withLapEndSamples);
  }

  stintsOf(sessionUid: SessionUid, driverKey?: DriverKey): StintRecord[] {
    return this.read<StintRecord>(this.statements.stints, sessionUid, driverKey);
  }

  pitStopsOf(sessionUid: SessionUid, driverKey?: DriverKey): PitStopRecord[] {
    return this.read<PitStopRecord>(this.statements.pitStops, sessionUid, driverKey);
  }

  flagPhasesOf(sessionUid: SessionUid): FlagPhase[] {
    return (this.statements.flagPhases.all(sessionUid) as string[]).map((json) => JSON.parse(json) as FlagPhase);
  }

  eventsOf(sessionUid: SessionUid): RaceEvent[] {
    return (this.statements.events.all(sessionUid) as string[]).map((json) => JSON.parse(json) as RaceEvent);
  }

  /**
   * The weekend's sessions `driverKey` (the player) took part in, oldest first, each with every driver stored for it and
   * that driver's own records, ordered by car id; with `before`, only sessions that started earlier than it.
   */
  weekendContext(weekendId: string, driverKey: DriverKey, opts: { before?: SessionUid } = {}): WeekendContext {
    const rows = this.statements.weekendSessionsOfDriverBefore.all({
      weekendId,
      driverKey: driverKeyString(driverKey),
      before: opts.before ?? null,
    }) as SessionDbRow[];
    return {
      weekendId,
      driverKey,
      sessions: rows.map((row) => ({
        sessionUid: row.session_uid,
        sessionType: row.session_type,
        drivers: this.driversOf(row.session_uid).map((driver) => ({
          driverKey: driver.driverKey,
          laps: this.lapsOf(row.session_uid, driver.driverKey),
          stints: this.stintsOf(row.session_uid, driver.driverKey),
          pitStops: this.pitStopsOf(row.session_uid, driver.driverKey),
        })),
      })),
    };
  }

  private read<T>(statement: { all(params: object): unknown[] }, sessionUid: SessionUid, driverKey: DriverKey | undefined): T[] {
    const rows = statement.all({ sessionUid, driverKey: driverKey ? driverKeyString(driverKey) : null }) as string[];
    return rows.map((json) => JSON.parse(json) as T);
  }

  private driversOf(sessionUid: SessionUid): SessionRow['drivers'] {
    const rows = this.statements.drivers.all(sessionUid) as DriverDbRow[];
    return rows.map((d) => ({ carId: d.car_id as CarId, driverKey: JSON.parse(d.key_json) as DriverKey }));
  }

  private toSession(row: SessionDbRow): SessionRow {
    return {
      sessionUid: row.session_uid,
      weekendId: row.weekend_id,
      seasonId: row.season_id,
      sessionType: row.session_type,
      trackId: row.track_id,
      startedAt: row.started_at,
      pwrecPath: row.pwrec_path,
      settings: JSON.parse(row.settings) as Record<string, number>,
      drivers: this.driversOf(row.session_uid),
    };
  }
}
