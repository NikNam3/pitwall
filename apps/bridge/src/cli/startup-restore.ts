// The startup restore (C59, C61; SP4.3d spec §7.0 rule 4): live, before input opens, each feed gets back the run of its
// ended qualifying, so the planning round between qualifying and the race survives a bridge restart.
import { existsSync } from 'node:fs';
import type { FeedId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { isEndedQualifying } from '../pipeline/ended-qualifying.ts';
import { readPwrecMeta } from '../pwrec/reader.ts';
import type { Db, SessionKey, StoredSessionRow } from '../storage/db.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';
import type { RebuildProgress } from './rebuild-database.ts';

/** A live feed as the startup restore sees it: its id and its UDP port (none: only `listenPort` 0 recordings). */
export type RestoreFeed = { feedId: FeedId; port: number | undefined };

type KeyRow = { session_uid: string; weekend_id: string; player_car: number };

/** The recording's meta `listenPort`; `undefined` when it cannot be read. */
function listenPortOf(path: string, log: Logger): number | undefined {
  try {
    return readPwrecMeta(path).listenPort;
  } catch (error) {
    log.warn({ pwrecPath: path, err: error }, 'recording meta not read: not restored at startup');
    return undefined;
  }
}

/**
 * Per feed, the newest stored session (by start) whose recording is there and whose meta `listenPort` is the feed's
 * port, or `0` (an older recording) when the bridge runs one feed.
 */
export function newestSessionsOf(db: Db, feeds: readonly RestoreFeed[], log: Logger): Map<FeedId, StoredSessionRow> {
  const repo = new WeekendRepository(db, { log });
  const keys = db.prepare('SELECT session_uid, weekend_id, player_car FROM sessions ORDER BY started_at DESC, session_uid DESC, player_car DESC').all() as KeyRow[];
  const found = new Map<FeedId, StoredSessionRow>();
  for (const key of keys) {
    if (found.size === feeds.length) break;
    const row = repo.sessionOf({ sessionUid: key.session_uid, weekendId: key.weekend_id, playerCar: key.player_car } as SessionKey);
    if (row?.pwrecPath == null || !existsSync(row.pwrecPath)) continue;
    const port = listenPortOf(row.pwrecPath, log);
    if (port === undefined) continue;
    const feed = feeds.find((f) => !found.has(f.feedId) && (port === (f.port ?? 0) || (port === 0 && feeds.length === 1)));
    if (feed !== undefined) found.set(feed.feedId, row);
  }
  return found;
}

/**
 * The sessions to restore at startup, per feed: its newest stored session (`newestSessionsOf`) when its recording is an
 * ended qualifying (`isEndedQualifying`).
 */
export async function endedQualifyingsOf(db: Db, feeds: readonly RestoreFeed[], log: Logger): Promise<Map<FeedId, StoredSessionRow>> {
  const restore = new Map<FeedId, StoredSessionRow>();
  for (const [feed, row] of newestSessionsOf(db, feeds, log)) {
    if (row.pwrecPath !== null && (await isEndedQualifying(row.pwrecPath, log))) restore.set(feed, row);
  }
  return restore;
}

/** Restores each feed's ended qualifying in turn, with progress shown as the startup rebuild shows it (C61). */
export async function restoreEndedSessions(
  restores: readonly { row: StoredSessionRow; restore: (row: StoredSessionRow) => Promise<void> }[],
  report: { line: (text: string) => void; progress?: RebuildProgress },
): Promise<void> {
  if (restores.length === 0) return;
  report.progress?.(0, restores.length);
  for (const [i, { row, restore }] of restores.entries()) {
    report.line(`pitwall: restoring ${i + 1}/${restores.length}: ${row.pwrecPath}`);
    await restore(row);
    report.progress?.(i + 1, restores.length);
  }
}
