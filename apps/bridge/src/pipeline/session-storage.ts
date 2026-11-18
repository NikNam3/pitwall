// The storage of one session (C24, C59–C62): its row and cars, its log, its weekend context.
import { carKeyOf, known, unknown, type CarId, type CarKey, type SessionState, type SessionUid, type WeekendPhase } from '@pitwall/domain';
import type { DeepReadonly, EngineState, BasisContext } from '@pitwall/engine/readers';
import type { Logger } from '../log.ts';
import type { Db, SessionKey, StoredSessionKind, SessionRow, StoredSessionRow } from '../storage/db.ts';
import { StorageWriter } from '../storage/storage-writer.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';

/**
 * A session row from the engine's values (C6: storage sees no packet type) and the recording's: the session as the live
 * state holds it, the feed's player car, the teammate the engine placed (`live.teammateCar`, C43: no rule of the bridge's
 * own) and every slot's team and race number from the live identity (C62). No situation and no signal shapes it (C13, C32).
 */
export type SessionRowInput = {
  sessionUid: SessionUid;
  session: Pick<SessionState, 'link' | 'trackId' | 'settings' | 'totalLaps'>;
  playerCar: CarId;
  /** The engine's `live.teammateCar` now; `null` when it placed none. */
  teammateCar: CarId | null;
  startedAt: string;
  pwrecPath: string | null;
  cars: SessionRow['cars'];
  /** The session's weekend phase as the machine decided it (C14); `pending` until it has. The row keeps its kind (C62). */
  weekendPhase: WeekendPhase;
};

/** The kind a session's row stores for its weekend phase: `none` while pending or for the `none` phase. */
export const sessionKindOf = (phase: WeekendPhase): StoredSessionKind => (phase.kind === 'pending' ? 'none' : phase.kind);

export const sessionRowOf = (s: SessionRowInput): SessionRow => ({
  sessionUid: s.sessionUid,
  weekendId: String(s.session.link.weekend),
  seasonId: String(s.session.link.season),
  playerCar: s.playerCar,
  teammateCar: s.teammateCar,
  trackId: s.session.trackId,
  startedAt: s.startedAt,
  pwrecPath: s.pwrecPath,
  // the race's laps with the settings (fixed for the session, ruling R17): the planning round suggests them (§7.1 step 3)
  settings: { ...s.session.settings, totalLaps: s.session.totalLaps },
  cars: s.cars,
  kind: sessionKindOf(s.weekendPhase),
});

/**
 * Every slot's car key and driver name from the live identity, with no car-status filter (C62; B2). The game sends an
 * empty name for a slot it names no driver for: unknown (C3), never an empty string.
 */
export const carsOf = (live: DeepReadonly<Pick<EngineState, 'cars'>>): SessionRow['cars'] =>
  live.cars.map((car) => ({
    carId: car.id,
    carKey: carKeyOf(car.identity),
    driver: car.identity.name === '' ? unknown('notReceived') : known(car.identity.name, 0),
  }));

/**
 * How a session reaches storage: `append` (live) appends its log frame by frame and marks it complete at its end;
 * `replace` (a rebuild, reprocess or import of a recording) writes it once, at its end, replacing the stored one (C24);
 * `read` (the restore of a session stored complete, C59) writes nothing and only reads the weekend context (C62).
 */
export type StorageMode = 'append' | 'replace' | 'read';

export type SessionStorageOptions = {
  log: Logger;
  onError: (error: unknown) => void;
  /** The rules version the session's log is stored with (C61). */
  rulesVersion: string;
  mode: StorageMode;
  /** Rebuilds a stored session the weekend context skipped as stale, in the background (C61). */
  rebuild?: (row: StoredSessionRow) => Promise<void>;
  /** Live only: called once the session's log is stored complete (the calibration store's candidates change, C62a). */
  onStored?: () => void;
};

const keyOf = (row: SessionKey): SessionKey => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar });
const sameKey = (a: SessionKey, b: SessionKey): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;

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

  /**
   * The session starts: live, its row and cars are written. `continued`: the run continues the session's stored
   * recording (C59), so a log stored under its key with this rules version is kept and only appended to; any other
   * stored log under its key is replaced whole (C24, C61).
   */
  start(row: SessionRow, opts: { continued: boolean }): void {
    if (this.#o.mode === 'append') this.#access?.writer.startSession(row, opts);
  }

  /** The session's row and cars whenever its identity or its teammate changed (the newest wins); live only. */
  upsertSession(row: SessionRow): void {
    if (this.#o.mode === 'append') this.#access?.writer.upsertSession(row);
  }

  /** What the session's log gained since the last write; live only. */
  writeLog(key: SessionKey, log: DeepReadonly<EngineState['log']>): void {
    if (this.#o.mode === 'append') this.#access?.writer.writeLog(key, log);
  }

  /**
   * The session ended with `log` complete (its closing spans in it): live, the rest is appended and the session marked
   * complete; a rebuild replaces the stored log whole. `interrupted`: the input was stopped before the session ended
   * (a bridge stop, a stopped rebuild), so its closing spans never happened: nothing is written and the stored log
   * stays as it was, a live one incomplete, to be continued by the next run (C24, C38, C59). `read` writes nothing.
   */
  finish(row: SessionRow, log: DeepReadonly<EngineState['log']>, opts: { interrupted: boolean }): void {
    const writer = this.#access?.writer;
    if (writer === undefined || opts.interrupted || this.#o.mode === 'read') return;
    if (this.#o.mode === 'append') {
      writer.writeLog(keyOf(row), log);
      if (this.#access !== undefined) writer.complete(keyOf(row));
    } else {
      writer.replaceLog(row, log, this.#o.rulesVersion);
    }
    // Stored complete, unless the write failed (storage then is off).
    if (this.#access !== undefined) this.#o.onStored?.();
  }

  /**
   * A rebuild of a recording that holds no session end (C59, C61): `log` is the log as the stopped live run left it (no
   * closing span applied), and it replaces the stored one whole with the row left incomplete, so the live run that
   * continues the recording appends to it (C24, C38). Only a rebuild (`replace`) writes; live, the log is already stored.
   */
  finishUnended(row: SessionRow, log: DeepReadonly<EngineState['log']>): void {
    if (this.#o.mode === 'replace') this.#access?.writer.replaceLog(row, log, this.#o.rulesVersion, { complete: false });
  }

  /**
   * The player's earlier sessions of the weekend (C62); `undefined` when storage is off. Stale ones (not complete, or of
   * another rules version) are left out and handed to `rebuild`, in the background.
   */
  weekendContext(row: SessionRow, player: CarKey): BasisContext | undefined {
    const repo = this.#access?.repo;
    if (repo === undefined) return undefined;
    try {
      const { context, incomplete } = repo.weekendContext(row.weekendId, player, keyOf(row), { startedAt: row.startedAt });
      if (incomplete.length > 0) this.#rebuildInBackground(repo.sessionsOf(row.weekendId).filter((s) => incomplete.some((k) => sameKey(k, s))));
      return context;
    } catch (error) {
      this.#fail(error);
      return undefined;
    }
  }

  #rebuildInBackground(rows: readonly StoredSessionRow[]): void {
    const { rebuild, log } = this.#o;
    if (rebuild === undefined) return;
    for (const stored of rows) {
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
