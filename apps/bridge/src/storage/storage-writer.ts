import type { Log } from '@pitwall/engine/log';
import type { DeepReadonly } from '@pitwall/engine/readers';
import type { Db, SessionKey, SessionRow } from './db.ts';
import { logRows } from './log-rows.ts';

export interface StorageWriterOptions {
  /** Called with every failed write; the writer itself never throws, so storage cannot stop the live feed. */
  readonly onError: (error: unknown) => void;
  /** The rules version a live session's row is stored with (C61). */
  readonly rulesVersion: string;
}

/** The rows of one stored session, bound to `@sessionUid`, `@weekendId` and `@playerCar`. */
const OF_SESSION = 'session_uid = @sessionUid AND weekend_id = @weekendId AND player_car = @playerCar';

/** The named parameters of a key; a caller's key object may carry more fields than a statement binds. */
const keyParams = ({ sessionUid, weekendId, playerCar }: SessionKey) => ({ sessionUid, weekendId, playerCar });
const keyString = ({ sessionUid, weekendId, playerCar }: SessionKey): string => `${sessionUid}/${weekendId}/${playerCar}`;

/**
 * Writes each session's log as it is (C24, C60), one transaction per call. A live session appends what each list of its
 * log gained since the writer's last write (`writeLog`) and is marked complete once its closing spans are written
 * (`complete`); no fact row is ever changed or removed. A rebuild replaces a session's log as a whole (`replaceLog`).
 */
export class StorageWriter {
  readonly #db: Db;
  readonly #onError: (error: unknown) => void;
  readonly #rulesVersion: string;
  readonly #statements;
  /** Per session key, the log positions written so far, by list (`voids` and `spans:<machine>` included). */
  readonly #written = new Map<string, Map<string, number>>();

  constructor(db: Db, options: StorageWriterOptions) {
    this.#db = db;
    this.#onError = options.onError;
    this.#rulesVersion = options.rulesVersion;
    this.#statements = {
      insertWeekend: db.prepare('INSERT OR IGNORE INTO weekends (weekend_id, season_id, track_id) VALUES (?, ?, ?)'),
      upsertSession: db.prepare(
        `INSERT INTO sessions (session_uid, weekend_id, player_car, teammate_car, track_id, started_at, pwrec_path, settings, rules_version, complete)
         VALUES (@sessionUid, @weekendId, @playerCar, @teammateCar, @trackId, @startedAt, @pwrecPath, @settings, @rulesVersion, @complete)
         ON CONFLICT (session_uid, weekend_id, player_car) DO UPDATE SET teammate_car = excluded.teammate_car, track_id = excluded.track_id, started_at = excluded.started_at,
           pwrec_path = excluded.pwrec_path, settings = excluded.settings, rules_version = excluded.rules_version, complete = excluded.complete`,
      ),
      deleteCars: db.prepare(`DELETE FROM cars WHERE ${OF_SESSION}`),
      insertCar: db.prepare(
        `INSERT INTO cars (session_uid, weekend_id, player_car, car_id, team_id, race_number, name)
         VALUES (@sessionUid, @weekendId, @playerCar, @carId, @teamId, @raceNumber, @name)`,
      ),
      insertFact: db.prepare(
        `INSERT INTO facts (session_uid, weekend_id, player_car, list, seq, car_id, record)
         VALUES (@sessionUid, @weekendId, @playerCar, @list, @seq, @carId, @record)`,
      ),
      deleteFacts: db.prepare(`DELETE FROM facts WHERE ${OF_SESSION}`),
      complete: db.prepare(`UPDATE sessions SET complete = 1 WHERE ${OF_SESSION}`),
    };
  }

  /**
   * Inserts the weekend if new, writes the session's row (not complete, with this writer's rules version) and replaces
   * its cars: the newest Participants win.
   */
  upsertSession(row: SessionRow): void {
    this.#guarded(() => this.#db.transaction(() => this.#writeRow(row, this.#rulesVersion, false))());
  }

  /**
   * A live session starts under `row`'s key: in one transaction the log stored under that key, if any (the bridge
   * restarted mid-session), is replaced by an empty one, and the row (not complete, pointing at the new recording) and
   * its cars are written. The newest run wins; its log is then appended from position 0.
   */
  startSession(row: SessionRow): void {
    const key = keyParams(row);
    this.#guarded(() => {
      this.#db.transaction(() => {
        this.#statements.deleteFacts.run(key);
        this.#writeRow(row, this.#rulesVersion, false);
      })();
      this.#written.set(keyString(row), new Map());
    });
  }

  /** Appends what each list of `log` gained since this writer's last write for `key`; nothing new writes nothing (C24). */
  writeLog(key: SessionKey, log: DeepReadonly<Log>): void {
    const written = this.#written.get(keyString(key)) ?? new Map<string, number>();
    const rows = logRows(log, (list) => written.get(list) ?? 0);
    if (rows.length === 0) return;
    this.#guarded(() => {
      this.#db.transaction(() => {
        for (const row of rows) this.#statements.insertFact.run({ ...keyParams(key), ...row });
      })();
      for (const row of rows) written.set(row.list, row.seq + 1);
      this.#written.set(keyString(key), written);
    });
  }

  /** The session's log is complete: its closing spans are written (C61). */
  complete(key: SessionKey): void {
    this.#guarded(() => this.#statements.complete.run(keyParams(key)));
  }

  /**
   * A rebuild (C24, C61): in one transaction, deletes the session's fact and car rows and writes `log` whole, the cars
   * and the row, complete, with `rulesVersion`. A failure leaves the old log and row as they were.
   */
  replaceLog(row: SessionRow, log: DeepReadonly<Log>, rulesVersion: string): void {
    const key = keyParams(row);
    const rows = logRows(log, () => 0);
    this.#guarded(() => {
      this.#db.transaction(() => {
        this.#statements.deleteFacts.run(key);
        this.#writeRow(row, rulesVersion, true);
        for (const fact of rows) this.#statements.insertFact.run({ ...key, ...fact });
      })();
      const written = new Map<string, number>();
      for (const fact of rows) written.set(fact.list, fact.seq + 1);
      this.#written.set(keyString(row), written);
    });
  }

  #writeRow(row: SessionRow, rulesVersion: string, complete: boolean): void {
    const s = this.#statements;
    const key = keyParams(row);
    s.insertWeekend.run(row.weekendId, row.seasonId, row.trackId);
    s.upsertSession.run({
      ...key,
      teammateCar: row.teammateCar,
      trackId: row.trackId,
      startedAt: row.startedAt,
      pwrecPath: row.pwrecPath,
      settings: JSON.stringify(row.settings),
      rulesVersion,
      complete: complete ? 1 : 0,
    });
    s.deleteCars.run(key);
    for (const { carId, carKey, driver } of row.cars) {
      // A driver name the game does not send is stored as none (NULL), never as an empty string (C3).
      const name = driver.known ? driver.value : null;
      s.insertCar.run({ ...key, carId, teamId: carKey.teamId, raceNumber: carKey.raceNumber, name });
    }
  }

  #guarded(write: () => void): void {
    try {
      write();
    } catch (error) {
      this.#onError(error);
    }
  }
}
