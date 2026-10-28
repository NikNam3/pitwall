import { driverKeyString, type SessionUid } from '@pitwall/domain';
import type { DeepReadonly, History, HistoryDelta } from '@pitwall/engine';
import type { Db, SessionRow } from './db.ts';

export interface StorageWriterOptions {
  /** Called with every failed write; the writer itself never throws, so storage cannot stop the live feed. */
  readonly onError: (error: unknown) => void;
}

/** History lists that are written to storage, in the order of `writeConfirmed`'s statements. */
const STORED_TABLES = ['laps', 'stints', 'pit_stops', 'flag_phases', 'events'] as const;

/** Writes sessions and the confirmed part of the engine history; idempotent, one transaction per call. */
export class StorageWriter {
  private readonly db: Db;
  private readonly onError: (error: unknown) => void;
  private readonly statements;

  constructor(db: Db, options: StorageWriterOptions) {
    this.db = db;
    this.onError = options.onError;
    const upsertBySeq = (table: string, columns: string) => {
      const names = columns.split(', ');
      const updates = names.map((c) => `${c} = excluded.${c}`).join(', ');
      return db.prepare(
        `INSERT INTO ${table} (session_uid, seq, ${columns}) VALUES (@sessionUid, @seq, ${names.map((c) => `@${c}`).join(', ')})
         ON CONFLICT (session_uid, seq) DO UPDATE SET ${updates}`,
      );
    };
    this.statements = {
      insertWeekend: db.prepare('INSERT OR IGNORE INTO weekends (weekend_id, season_id, track_id) VALUES (?, ?, ?)'),
      upsertSession: db.prepare(
        `INSERT INTO sessions (session_uid, weekend_id, session_type, track_id, started_at, pwrec_path, settings)
         VALUES (@sessionUid, @weekendId, @sessionType, @trackId, @startedAt, @pwrecPath, @settings)
         ON CONFLICT (session_uid) DO UPDATE SET weekend_id = excluded.weekend_id, session_type = excluded.session_type,
           track_id = excluded.track_id, started_at = excluded.started_at, pwrec_path = excluded.pwrec_path, settings = excluded.settings`,
      ),
      deleteDrivers: db.prepare('DELETE FROM drivers WHERE session_uid = ?'),
      insertDriver: db.prepare('INSERT INTO drivers (session_uid, car_id, driver_key, key_json) VALUES (?, ?, ?, ?)'),
      upsertLap: db.prepare(
        `INSERT INTO laps (session_uid, car_id, lap_number, lap_time_ms, record) VALUES (@sessionUid, @carId, @lapNumber, @lapTimeMs, @record)
         ON CONFLICT (session_uid, car_id, lap_number) DO UPDATE SET lap_time_ms = excluded.lap_time_ms, record = excluded.record`,
      ),
      upsertStint: upsertBySeq('stints', 'car_id, record'),
      upsertPitStop: upsertBySeq('pit_stops', 'car_id, record'),
      upsertFlagPhase: upsertBySeq('flag_phases', 'record'),
      upsertEvent: upsertBySeq('events', 'car_id, record'),
      clear: STORED_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE session_uid = ?`)),
    };
  }

  /** Inserts the weekend if new, upserts the session by uid and replaces its drivers. */
  upsertSession(row: SessionRow): void {
    this.guarded(() =>
      this.db.transaction(() => {
        const s = this.statements;
        s.insertWeekend.run(row.weekendId, row.seasonId, row.trackId);
        s.upsertSession.run({ ...row, settings: JSON.stringify(row.settings) });
        s.deleteDrivers.run(row.sessionUid);
        for (const d of row.drivers) s.insertDriver.run(row.sessionUid, d.carId, driverKeyString(d.driverKey), JSON.stringify(d.driverKey));
      })(),
    );
  }

  /**
   * Writes the history entries `delta` adds (confirmed laps only). A truncated delta (flashback) first drops the
   * session's stored history and rewrites everything up to `delta.after`.
   */
  writeConfirmed(sessionUid: SessionUid, history: DeepReadonly<History>, delta: HistoryDelta): void {
    const from = (list: keyof History) => (delta.truncated ? 0 : delta.before[list]);
    const added = <T>(list: keyof History, items: readonly T[]) => items.slice(from(list), delta.after[list]);
    const laps = added('laps', history.laps).filter((l) => l.status === 'confirmed');
    const stints = added('stints', history.stints);
    const pitStops = added('pitStops', history.pitStops);
    const flagPhases = added('flagPhases', history.flagPhases);
    const events = added('events', history.events);
    const nothingToWrite = [laps, stints, pitStops, flagPhases, events].every((list) => list.length === 0);
    if (nothingToWrite && !delta.truncated) return;

    this.guarded(() =>
      this.db.transaction(() => {
        const s = this.statements;
        if (delta.truncated) for (const clear of s.clear) clear.run(sessionUid);
        for (const lap of laps) {
          s.upsertLap.run({ sessionUid, carId: lap.carId, lapNumber: lap.lapNumber, lapTimeMs: lap.lapTimeMs, record: JSON.stringify(lap) });
        }
        stints.forEach((r, i) => s.upsertStint.run({ sessionUid, seq: from('stints') + i, car_id: r.carId, record: JSON.stringify(r) }));
        pitStops.forEach((r, i) => s.upsertPitStop.run({ sessionUid, seq: from('pitStops') + i, car_id: r.carId, record: JSON.stringify(r) }));
        flagPhases.forEach((r, i) => s.upsertFlagPhase.run({ sessionUid, seq: from('flagPhases') + i, record: JSON.stringify(r) }));
        events.forEach((r, i) => s.upsertEvent.run({ sessionUid, seq: from('events') + i, car_id: r.carId ?? null, record: JSON.stringify(r) }));
      })(),
    );
  }

  private guarded(write: () => void): void {
    try {
      write();
    } catch (error) {
      this.onError(error);
    }
  }
}
