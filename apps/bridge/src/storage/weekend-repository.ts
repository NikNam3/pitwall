import { existsSync } from 'node:fs';
import { unknown, type CarId, type CarKey, type Known, type SessionUid, type TrackData, type WeekendPhase } from '@pitwall/domain';
import { projectionOfLog } from '@pitwall/engine/log';
import type { DeepReadonly, Projection, ProjectionState, StoredSession, WeekendContext } from '@pitwall/engine/readers';
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
  /**
   * The rules version this bridge computes (C61): a session stored under another one is stale, like one whose log is not
   * complete. Without it only completeness is checked.
   */
  rulesVersion?: string;
  /** The track file a stored session ran with (C62b), for `sessionsOnTrack`. Default: `notApplicable`. */
  track?: (row: StoredSessionRow) => Known<DeepReadonly<TrackData>>;
};

/**
 * A complete stored session on a track, as the calibration store reads it (C62a): its row, its weekend phase (from its
 * weekend-phase span), the track file it ran with and its projection (C34). A session of another rules version is
 * `stale` and has no projection: it is never served before its rebuild (C61).
 */
export type TrackSession = StoredSessionRow & {
  phase: WeekendPhase;
  stale: boolean;
  projection: ProjectionState | undefined;
  track: Known<DeepReadonly<TrackData>>;
};

/** The read of the stored sessions on one track the calibration store needs. */
export type SessionsOnTrack = Pick<WeekendRepository, 'sessionsOnTrack'>;

/** The weekend phase a session's weekend-phase span stands for; `pending` without one. */
const phaseOf = (projection: Projection): WeekendPhase => {
  const span = projection.spans['weekend-phase']?.[0];
  return span === undefined ? { kind: 'pending' } : ({ kind: span.kind, ...(span.detail as object) } as WeekendPhase);
};

/** A stored session is stale when its log is not complete or another rules version produced it (C61): it is never served. */
export const isStale = (row: Pick<StoredSessionRow, 'complete' | 'rulesVersion'>, rulesVersion: string | undefined): boolean =>
  !row.complete || (rulesVersion !== undefined && row.rulesVersion !== rulesVersion);

const keyOf = (row: SessionDbRow): SessionKey => ({ sessionUid: row.session_uid, weekendId: row.weekend_id, playerCar: row.player_car as CarId });
/** The named parameters of a key; a caller's key object may carry more fields than a statement binds. */
const keyParams = ({ sessionUid, weekendId, playerCar }: SessionKey) => ({ sessionUid, weekendId, playerCar });
const keyText = ({ sessionUid, weekendId, playerCar }: SessionKey): string => `${sessionUid}/${weekendId}/${playerCar}`;
const OF_SESSION = 'session_uid = @sessionUid AND weekend_id = @weekendId AND player_car = @playerCar';

/**
 * The read side of storage: the sessions of a weekend (the rows), and the one read API (C34), a stored session's
 * projection, computed from its stored log by the engine's projection module (C28). A stale session (`isStale`: its log
 * not complete, or of another rules version) is never served (C61): `projectionOf` rebuilds it from its recording first;
 * a session whose recording is missing, or that its rebuild does not produce, is neither served nor deleted (C24), and
 * is warned about once per repository.
 */
export class WeekendRepository {
  readonly #statements;
  readonly #log: Logger;
  readonly #rebuild: WeekendRepositoryOptions['rebuild'];
  readonly #rulesVersion: string | undefined;
  readonly #track: NonNullable<WeekendRepositoryOptions['track']>;
  /** The sessions found unservable and warned about (`keyText`): neither rebuilt again nor warned about again. */
  readonly #unservable = new Set<string>();

  constructor(db: Db, opts: WeekendRepositoryOptions = {}) {
    this.#log = opts.log ?? createLogger({ level: 'silent' });
    this.#rebuild = opts.rebuild;
    this.#rulesVersion = opts.rulesVersion;
    this.#track = opts.track ?? (() => unknown('notApplicable'));
    const sessionColumns = `s.session_uid, s.weekend_id, w.season_id, s.player_car, s.track_id, s.started_at, s.pwrec_path, s.settings, s.rules_version, s.complete`;
    const sessionsFrom = `FROM sessions s JOIN weekends w ON w.weekend_id = s.weekend_id`;
    this.#statements = {
      weekendSessions: db.prepare(`SELECT ${sessionColumns} ${sessionsFrom} WHERE s.weekend_id = ? ORDER BY s.started_at, s.session_uid, s.player_car`),
      trackSessions: db.prepare(
        `SELECT ${sessionColumns} ${sessionsFrom} WHERE s.track_id = ? AND s.complete = 1 ORDER BY s.started_at, s.session_uid, s.player_car`,
      ),
      newestWeekend: db.prepare(`SELECT weekend_id FROM sessions ORDER BY started_at DESC, session_uid DESC, player_car DESC LIMIT 1`).pluck(),
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
   * The complete stored sessions on `trackId` in start order (C62a), each with its weekend phase and track file. One of
   * another rules version is `stale` and comes without its projection (C61); an incomplete one is left out.
   */
  sessionsOnTrack(trackId: number): TrackSession[] {
    return (this.#statements.trackSessions.all(trackId) as SessionDbRow[]).map((dbRow) => {
      const row = this.#toSession(dbRow);
      const projection = this.#projectionOfStored(keyOf(dbRow));
      const stale = isStale(row, this.#rulesVersion);
      return { ...row, phase: phaseOf(projection), stale, projection: stale ? undefined : (projection as ProjectionState), track: this.#track(row) };
    });
  }

  /** The weekend of the newest stored session (by start); `undefined` when none is stored. */
  newestWeekendId(): string | undefined {
    return this.#statements.newestWeekend.get() as string | undefined;
  }

  /** The weekend's stale sessions (`isStale`) in start order. */
  staleSessionsOf(weekendId: string): StoredSessionRow[] {
    return this.sessionsOf(weekendId).filter((row) => isStale(row, this.#rulesVersion));
  }

  /**
   * The stored session's projection (C34); `undefined` when nothing is stored under `key`. A stale session is rebuilt
   * from its recording first; one whose recording is missing, or that the rebuild does not produce, is not served, with
   * one warning, and stays stored as it is. The projection is the caller's own: it is computed from the log read for
   * this call, so no one else holds its lists.
   */
  async projectionOf(key: SessionKey): Promise<ProjectionState | undefined> {
    const row = this.#row(key);
    if (row === undefined) return undefined;
    if (isStale(row, this.#rulesVersion)) {
      if (this.#unservable.has(keyText(key))) return undefined;
      if (!this.#canRebuild(row)) {
        this.#warnUnservable(row, row.pwrecPath === null || !existsSync(row.pwrecPath) ? 'its recording is missing: not served, kept' : 'not served');
        return undefined;
      }
      await this.#rebuild?.(row);
      const rebuilt = this.#row(key);
      if (rebuilt === undefined || isStale(rebuilt, this.#rulesVersion)) {
        this.#warnUnservable(row, 'not rebuilt: not served, kept');
        return undefined;
      }
    }
    return this.#projectionOfStored(key) as ProjectionState;
  }

  /**
   * The weekend context of the session `before` (C39, C62): the weekend's sessions that started before it whose player
   * car had `player`'s team and race number, oldest first, each with its cars by car id and its projection. A stale
   * session (`isStale`) is skipped with a warning and its key returned in `incomplete`, so the caller rebuilds it.
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
      if (isStale({ complete: dbRow.complete === 1, rulesVersion: dbRow.rules_version }, this.#rulesVersion)) {
        this.#log.warn({ sessionUid: key.sessionUid, weekendId: key.weekendId, playerCar: key.playerCar }, 'stored session stale, left out of the weekend context');
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

  #warnUnservable(row: StoredSessionRow, why: string): void {
    this.#unservable.add(keyText(row));
    this.#log.warn(
      { sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, pwrecPath: row.pwrecPath, rulesVersion: row.rulesVersion, complete: row.complete },
      `stored session stale, ${why}`,
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
