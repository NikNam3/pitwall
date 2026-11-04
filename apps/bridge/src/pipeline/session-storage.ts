// The storage of one session (C24, C59–C62): its row and cars, its log, its weekend context.
import { carKeyOf, type CarId, type CarKey, type SessionState, type SessionUid } from '@pitwall/domain';
import type { DeepReadonly, EngineState, WeekendContext } from '@pitwall/engine/readers';
import type { Logger } from '../log.ts';
import type { Db, SessionKey, SessionRow, StoredSessionRow } from '../storage/db.ts';
import { StorageWriter } from '../storage/storage-writer.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';

/**
 * A session row from the engine's values (C6: storage sees no packet type) and the recording's: the session as the live
 * state holds it, the feed's player car, and every slot's team and race number from the live identity (C62). No
 * situation and no signal shapes it (C13, C32).
 */
export type SessionRowInput = {
  sessionUid: SessionUid;
  session: Pick<SessionState, 'link' | 'trackId' | 'settings'>;
  playerCar: CarId;
  startedAt: string;
  pwrecPath: string | null;
  cars: SessionRow['cars'];
};

export const sessionRowOf = (s: SessionRowInput): SessionRow => ({
  sessionUid: s.sessionUid,
  weekendId: String(s.session.link.weekend),
  seasonId: String(s.session.link.season),
  playerCar: s.playerCar,
  trackId: s.session.trackId,
  startedAt: s.startedAt,
  pwrecPath: s.pwrecPath,
  settings: { ...s.session.settings },
  cars: s.cars,
});

/** Every slot's car key from the live identity, with no car-status filter (C62; B2). */
export const carsOf = (live: DeepReadonly<Pick<EngineState, 'cars'>>): SessionRow['cars'] =>
  live.cars.map((car) => ({ carId: car.id, carKey: carKeyOf(car.identity) }));

/**
 * How a session reaches storage: `append` (live) appends its log frame by frame and marks it complete at its end;
 * `replace` (a rebuild, reprocess or import of a recording) writes it once, at its end, replacing the stored one (C24).
 */
export type StorageMode = 'append' | 'replace';

export type SessionStorageOptions = {
  log: Logger;
  onError: (error: unknown) => void;
  /** The rules version the session's log is stored with (C61). */
  rulesVersion: string;
  mode: StorageMode;
  /** Rebuilds a stored session the weekend context skipped as stale, in the background (C61). */
  rebuild?: (row: StoredSessionRow) => Promise<void>;
};

const keyOf = (row: SessionKey): SessionKey => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar });

/**
 * One session's access to the database. Never throws: the first failure goes to `onError` and turns storage off
 * for the rest of the session, so the live topics carry on without it.
 */
export class SessionStorage {
  readonly #o: SessionStorageOptions;
  #access: { writer: StorageWriter; repo: WeekendRepository } | undefined;

  constructor(db: Db, opts: SessionStorageOptions) {
    this.#o = opts;
    try {
      this.#access = {
        writer: new StorageWriter(db, { onError: (error) => this.#fail(error), rulesVersion: opts.rulesVersion }),
        repo: new WeekendRepository(db, { log: opts.log, rulesVersion: opts.rulesVersion }),
      };
    } catch (error) {
      this.#fail(error);
    }
  }

  /** The session starts: live, its row and cars are written and a log stored under its key is replaced (the newest run wins). */
  start(row: SessionRow): void {
    if (this.#o.mode === 'append') this.#access?.writer.startSession(row);
  }

  /** The session's row and cars whenever its identity changed (the newest wins); live only. */
  upsertSession(row: SessionRow): void {
    if (this.#o.mode === 'append') this.#access?.writer.upsertSession(row);
  }

  /** What the session's log gained since the last write; live only. */
  writeLog(key: SessionKey, log: DeepReadonly<EngineState['log']>): void {
    if (this.#o.mode === 'append') this.#access?.writer.writeLog(key, log);
  }

  /**
   * The session ended with `log` complete (its closing spans in it): live, the rest is appended and the session marked
   * complete; a rebuild replaces the stored log whole. `interrupted`: a rebuild that was stopped before the recording's
   * end writes nothing, so the stored log stays as it was (C24).
   */
  finish(row: SessionRow, log: DeepReadonly<EngineState['log']>, opts: { interrupted: boolean }): void {
    const writer = this.#access?.writer;
    if (writer === undefined) return;
    if (this.#o.mode === 'append') {
      writer.writeLog(keyOf(row), log);
      if (this.#access !== undefined) writer.complete(keyOf(row));
    } else if (!opts.interrupted) {
      writer.replaceLog(row, log, this.#o.rulesVersion);
    }
  }

  /**
   * The player's earlier sessions of the weekend (C62); `undefined` when storage is off. Stale ones (not complete, or of
   * another rules version) are left out and handed to `rebuild`, in the background.
   */
  weekendContext(row: SessionRow, player: CarKey): WeekendContext | undefined {
    const repo = this.#access?.repo;
    if (repo === undefined) return undefined;
    try {
      const { context, incomplete } = repo.weekendContext(row.weekendId, player, keyOf(row), { startedAt: row.startedAt });
      if (incomplete.length > 0) this.#rebuildInBackground(repo, row.weekendId, incomplete);
      return context;
    } catch (error) {
      this.#fail(error);
      return undefined;
    }
  }

  #rebuildInBackground(repo: WeekendRepository, weekendId: string, keys: readonly SessionKey[]): void {
    const { rebuild, log } = this.#o;
    if (rebuild === undefined) return;
    const same = (a: SessionKey, b: SessionKey) => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;
    for (const stored of repo.sessionsOf(weekendId).filter((s) => keys.some((k) => same(k, s)))) {
      rebuild(stored).catch((error: unknown) => {
        log.error({ sessionUid: stored.sessionUid, weekendId: stored.weekendId, playerCar: stored.playerCar, err: error }, 'stored session not rebuilt');
      });
    }
  }

  /** Storage is off from the first failure on, so `onError` is called at most once. */
  #fail(error: unknown): void {
    this.#access = undefined;
    this.#o.onError(error);
  }
}
