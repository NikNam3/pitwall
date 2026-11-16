import type { FeedId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import type { Db, SessionKey, StoredSessionRow } from '../storage/db.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';

export type StaleSweepOptions = {
  /** Every live feed of the run (C1a). */
  feeds: readonly FeedId[];
  db: Db;
  /** Rebuilds one stale stored session from its recording, in the background (`serve` re-checks it when it starts). */
  rebuild: (row: StoredSessionRow) => Promise<void>;
  /** The sessions the run's feeds run or restore now (`FeedPipeline.runningSession`). */
  running: () => ReadonlyArray<SessionKey | undefined>;
  log: Logger;
};

export const sameSessionKey = (a: SessionKey, b: SessionKey): boolean =>
  a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;

/**
 * The run's sweep of stale stored sessions (C59, C1a). A live session that continues no stored recording asks for it
 * (`request`); it runs once every feed of the run has received its first Session packet (`sessionSeen`), as a feed that
 * has not may still continue its stored session: no clock, no timeout, and a feed that never connects leaves the stale
 * sessions incomplete for a later run. It hands `rebuild` every stored session whose log is not complete that no feed
 * runs or restores.
 */
export class StaleSweep {
  readonly #o: StaleSweepOptions;
  readonly #seen = new Set<FeedId>();
  #requested = false;

  constructor(opts: StaleSweepOptions) {
    this.#o = opts;
  }

  /** The feed `feedId` received its first Session packet, and started or began restoring its session from it. */
  sessionSeen(feedId: FeedId): void {
    if (this.#seen.has(feedId)) return;
    this.#seen.add(feedId);
    this.#sweep();
  }

  /** A live session started that continues nothing. */
  request(): void {
    this.#requested = true;
    this.#sweep();
  }

  #sweep(): void {
    const { feeds, db, rebuild, running, log } = this.#o;
    if (!this.#requested || !feeds.every((feed) => this.#seen.has(feed))) return;
    this.#requested = false;
    const busy = running().filter((key): key is SessionKey => key !== undefined);
    let rows: StoredSessionRow[];
    try {
      rows = new WeekendRepository(db, { log }).incompleteSessions().filter((row) => !busy.some((key) => sameSessionKey(key, row)));
    } catch (error) {
      log.error({ err: error }, 'stale stored sessions not read');
      return;
    }
    for (const row of rows) {
      rebuild(row).catch((error: unknown) => {
        log.error({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, err: error }, 'stored session not rebuilt');
      });
    }
  }
}
