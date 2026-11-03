// The derived storage layer for one session (spec 9.2, 9.3): its row, its confirmed history, its weekend context.
import type { DriverKey, ParticipantsValues, SessionState, SessionUid } from '@pitwall/domain';
import type { HistoryDelta, Projection, WeekendContext } from '@pitwall/engine';
import type { Logger } from '../log.ts';
import type { Db, SessionKey, SessionRow } from '../storage/db.ts';
import { StorageWriter } from '../storage/storage-writer.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';

/**
 * A session row from the engine's values (C6: storage sees no packet type): the live state's session and, once
 * Participants named them, the driver of each slot the session uses.
 */
export type SessionRowInput = {
  sessionUid: SessionUid;
  session: Pick<SessionState, 'link' | 'sessionType' | 'trackId' | 'settings'>;
  startedAt: string;
  pwrecPath: string | null;
  drivers?: ParticipantsValues['drivers'];
};

export const sessionRowOf = (s: SessionRowInput): SessionRow => ({
  sessionUid: s.sessionUid,
  weekendId: String(s.session.link.weekend),
  seasonId: String(s.session.link.season),
  sessionType: s.session.sessionType,
  trackId: s.session.trackId,
  startedAt: s.startedAt,
  pwrecPath: s.pwrecPath,
  settings: { ...s.session.settings },
  drivers: s.drivers ?? [],
});

/**
 * One session's access to the database. Never throws: the first failure goes to `onError` and turns storage off
 * for the rest of the session, so the live topics carry on without it.
 */
export class SessionStorage {
  readonly #log: Logger;
  readonly #onError: (error: unknown) => void;
  #access: { writer: StorageWriter; repo: WeekendRepository } | undefined;

  constructor(db: Db, opts: { log: Logger; onError: (error: unknown) => void }) {
    this.#log = opts.log;
    this.#onError = opts.onError;
    try {
      this.#access = { writer: new StorageWriter(db, { onError: (error) => this.#fail(error) }), repo: new WeekendRepository(db) };
    } catch (error) {
      this.#fail(error);
    }
  }

  upsertSession(row: SessionRow): void {
    this.#access?.writer.upsertSession(row);
  }

  writeConfirmed(key: SessionKey, history: Projection, delta: HistoryDelta): void {
    this.#access?.writer.writeConfirmed(key, history, delta);
  }

  /** The player's earlier sessions of the weekend with every driver's records; `undefined` when storage is off or this session was never stored. */
  weekendContext({ sessionUid, weekendId }: SessionKey, driverKey: DriverKey): WeekendContext | undefined {
    const repo = this.#access?.repo;
    if (repo === undefined) return undefined;
    try {
      // Asked with an unknown `before`, the repository finds no earlier sessions: say so instead of losing them quietly.
      if (!repo.sessionsOf(weekendId).some((row) => row.sessionUid === sessionUid)) {
        this.#log.warn({ sessionUid, weekendId }, 'session not stored, starting without its weekend context');
        return undefined;
      }
      return repo.weekendContext(weekendId, driverKey, { before: sessionUid });
    } catch (error) {
      this.#fail(error);
      return undefined;
    }
  }

  /** Storage is off from the first failure on, so `onError` is called at most once. */
  #fail(error: unknown): void {
    this.#access = undefined;
    this.#onError(error);
  }
}
