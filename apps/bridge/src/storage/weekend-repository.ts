import { existsSync } from 'node:fs';
import type { CarId, CarKey, SessionUid } from '@pitwall/domain';
import { projectionOfLog } from '@pitwall/engine/log';
import type { Projection, ProjectionState, StoredSession, WeekendContext } from '@pitwall/engine/readers';
import { createLogger, type Logger } from '../log.ts';
import type { Db, SessionKey, SessionRow, StoredSessionRow } from './db.ts';
import { logOfRows, type StoredFact } from './log-rows.ts';

type SessionDbRow = {
  session_uid: string;
  weekend_id: string;
  season_id: string;
  player_car: number;
  track_id: number;
  started_at: string;
  pwrec_path: string | null;
  settings: string;
  rules_version: string;
  complete: number;
};

type CarDbRow = { car_id: number; team_id: number; race_number: number };

export type WeekendRepositoryOptions = {
  /** Where the warnings about sessions that cannot be served go. Default: nowhere. */
  log?: Logger;
  /** Rebuilds a session from its recording (`replaceLog`); without it an incomplete session is not served. */
  rebuild?: (row: StoredSessionRow) => Promise<void>;
};

const keyOf = (row: SessionDbRow): SessionKey => ({ sessionUid: row.session_uid, weekendId: row.weekend_id, playerCar: row.player_car as CarId });
/** The named parameters of a key; a caller's key object may carry more fields than a statement binds. */
const keyParams = ({ sessionUid, weekendId, playerCar }: SessionKey) => ({ sessionUid, weekendId, playerCar });
const OF_SESSION = 'session_uid = @sessionUid AND weekend_id = @weekendId AND player_car = @playerCar';

/**
 * The read side of storage: the sessions of a weekend (the rows), and the one read API (C34), a stored session's
 * projection, computed from its stored log by the engine's projection module (C28). A session whose log is not complete
 * is never served (C61): `projectionOf` rebuilds it from its recording first; a session whose recording is missing is
 * neither served nor deleted (C24).
 */
export class WeekendRepository {
  readonly #statements;
  readonly #log: Logger;
  readonly #rebuild: WeekendRepositoryOptions['rebuild'];

  constructor(db: Db, opts: WeekendRepositoryOptions = {}) {
    this.#log = opts.log ?? createLogger({ level: 'silent' });
    this.#rebuild = opts.rebuild;
    const sessionColumns = `s.session_uid, s.weekend_id, w.season_id, s.player_car, s.track_id, s.started_at, s.pwrec_path, s.settings, s.rules_version, s.complete`;
    const sessionsFrom = `FROM sessions s JOIN weekends w ON w.weekend_id = s.weekend_id`;
    this.#statements = {
      weekendSessions: db.prepare(`SELECT ${sessionColumns} ${sessionsFrom} WHERE s.weekend_id = ? ORDER BY s.started_at, s.session_uid, s.player_car`),
      session: db.prepare(
        `SELECT ${sessionColumns} ${sessionsFrom} WHERE s.session_uid = @sessionUid AND s.weekend_id = @weekendId AND s.player_car = @playerCar`,
      ),
      startedAt: db.prepare(`SELECT started_at FROM sessions WHERE ${OF_SESSION}`).pluck(),
      // The weekend's sessions that started before `@startedAt` whose own player car had the player's team and race number.
      playerSessionsBefore: db.prepare(
        `SELECT ${sessionColumns} ${sessionsFrom}
         WHERE s.weekend_id = @weekendId AND s.started_at < @startedAt
           AND EXISTS (
             SELECT 1 FROM cars c
             WHERE c.session_uid = s.session_uid AND c.weekend_id = s.weekend_id AND c.player_car = s.player_car
               AND c.car_id = s.player_car AND c.team_id = @teamId AND c.race_number = @raceNumber)
         ORDER BY s.started_at, s.session_uid, s.player_car`,
      ),
      cars: db.prepare(`SELECT car_id, team_id, race_number FROM cars WHERE ${OF_SESSION} ORDER BY car_id`),
      facts: db.prepare(`SELECT list, record FROM facts WHERE ${OF_SESSION} ORDER BY list, seq`),
    };
  }

  /** The weekend's rows in start order, each with its cars by car id, its rules version and whether it is complete. */
  sessionsOf(weekendId: string): StoredSessionRow[] {
    return (this.#statements.weekendSessions.all(weekendId) as SessionDbRow[]).map((row) => this.#toSession(row));
  }

  /**
   * The stored session's projection (C34); `undefined` when nothing is stored under `key`. A session whose log is not
   * complete is rebuilt from its recording first; one whose recording is missing (or that cannot be rebuilt) is not
   * served, with a warning, and stays stored as it is. The projection is the caller's own: it is computed from the log
   * read for this call, so no one else holds its lists.
   */
  async projectionOf(key: SessionKey): Promise<ProjectionState | undefined> {
    let row = this.#row(key);
    if (row === undefined) return undefined;
    if (!row.complete) {
      if (!this.#canRebuild(row)) {
        this.#warnIncomplete(row);
        return undefined;
      }
      await this.#rebuild?.(row);
      row = this.#row(key);
      if (row?.complete !== true) {
        this.#log.warn({ sessionUid: key.sessionUid, weekendId: key.weekendId, playerCar: key.playerCar }, 'stored session not rebuilt, not served');
        return undefined;
      }
    }
    return this.#projectionOfStored(key) as ProjectionState;
  }

  /**
   * The weekend context of the session `before` (C39, C62): the weekend's sessions that started before it whose player
   * car had `player`'s team and race number, oldest first, each with its cars by car id and its projection. A session
   * whose log is not complete is skipped with a warning and its key returned in `incomplete`, so the caller rebuilds it.
   * `startedAt` stands for `before`'s start when its row is not stored yet (a rebuild writes it at the end).
   */
  weekendContext(
    weekendId: string,
    player: CarKey,
    before: SessionKey,
    opts: { startedAt?: string } = {},
  ): { context: WeekendContext; incomplete: SessionKey[] } {
    const startedAt = opts.startedAt ?? (this.#statements.startedAt.get(keyParams(before)) as string | undefined);
    const rows =
      startedAt === undefined
        ? []
        : (this.#statements.playerSessionsBefore.all({ weekendId, startedAt, teamId: player.teamId, raceNumber: player.raceNumber }) as SessionDbRow[]);
    const sessions: StoredSession[] = [];
    const incomplete: SessionKey[] = [];
    for (const dbRow of rows) {
      const key = keyOf(dbRow);
      if (dbRow.complete !== 1) {
        this.#log.warn({ sessionUid: key.sessionUid, weekendId: key.weekendId, playerCar: key.playerCar }, 'stored session not complete, left out of the weekend context');
        incomplete.push(key);
        continue;
      }
      sessions.push({ sessionUid: key.sessionUid, playerCar: key.playerCar, cars: this.#carsOf(key), projection: this.#projectionOfStored(key) });
    }
    return { context: { weekendId, player: { teamId: player.teamId, raceNumber: player.raceNumber }, sessions }, incomplete };
  }

  #canRebuild(row: StoredSessionRow): boolean {
    return this.#rebuild !== undefined && row.pwrecPath !== null && existsSync(row.pwrecPath);
  }

  #warnIncomplete(row: StoredSessionRow): void {
    const missing = row.pwrecPath === null || !existsSync(row.pwrecPath);
    this.#log.warn(
      { sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, pwrecPath: row.pwrecPath },
      missing ? 'stored session not complete and its recording is missing: not served, kept' : 'stored session not complete: not served',
    );
  }

  #projectionOfStored(key: SessionKey): Projection {
    return projectionOfLog(logOfRows(this.#statements.facts.all(keyParams(key)) as StoredFact[]));
  }

  #row(key: SessionKey): StoredSessionRow | undefined {
    const row = this.#statements.session.get(keyParams(key)) as SessionDbRow | undefined;
    return row && this.#toSession(row);
  }

  #carsOf(key: SessionKey): SessionRow['cars'] {
    const rows = this.#statements.cars.all(keyParams(key)) as CarDbRow[];
    return rows.map((c) => ({ carId: c.car_id as CarId, carKey: { teamId: c.team_id, raceNumber: c.race_number } }));
  }

  #toSession(row: SessionDbRow): StoredSessionRow {
    return {
      sessionUid: row.session_uid as SessionUid,
      weekendId: row.weekend_id,
      seasonId: row.season_id,
      playerCar: row.player_car as CarId,
      trackId: row.track_id,
      startedAt: row.started_at,
      pwrecPath: row.pwrec_path,
      settings: JSON.parse(row.settings) as SessionRow['settings'],
      cars: this.#carsOf(keyOf(row)),
      rulesVersion: row.rules_version,
      complete: row.complete === 1,
    };
  }
}
