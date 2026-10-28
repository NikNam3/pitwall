import { existsSync } from 'node:fs';
import { StartupError } from '../../startup-error.ts';
import { dataDir } from '../../storage/data-dir.ts';
import { openDatabase, type Db } from '../../storage/db.ts';
import { StorageWriter } from '../../storage/storage-writer.ts';
import { WeekendRepository } from '../../storage/weekend-repository.ts';
import { EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { processRecordings, rebuildDatabase } from '../rebuild-database.ts';

/**
 * The recordings the stored sessions of one weekend came from, after deleting the sessions they rebuild, so the new
 * run leaves no stale rows. A session without a file cannot be rebuilt and is kept. Undefined when none is stored.
 */
function clearWeekend(db: Db, weekendId: string): string[] | undefined {
  const sessions = new WeekendRepository(db).sessionsOf(weekendId);
  if (sessions.length === 0) return undefined;
  const rebuilt = sessions.flatMap((s) => (s.pwrecPath === null ? [] : [{ sessionUid: s.sessionUid, path: s.pwrecPath }]));
  const missing = rebuilt.find(({ path }) => !existsSync(path));
  if (missing) throw new StartupError(`recording ${missing.path} not found; nothing was deleted`);
  // unlike the live feed, a failed delete stops the command
  const writer = new StorageWriter(db, {
    onError: (error) => {
      throw error;
    },
  });
  writer.deleteSessions(rebuilt.map(({ sessionUid }) => sessionUid));
  return [...new Set(rebuilt.map(({ path }) => path))];
}

/** `pitwall reprocess [--weekend id]`: rebuilds the database from the recordings, all of them or one weekend's. */
export async function run(_positionals: string[], values: { weekend?: string | undefined }, io: CliIo): Promise<number> {
  const dirs = dataDir(io.env);
  if (values.weekend === undefined) {
    const rebuilt = await rebuildDatabase(dirs, io);
    if (rebuilt === undefined) return EXIT_INTERRUPTED;
    rebuilt.db.close();
    io.out(`reprocessed ${rebuilt.recordings} recordings`);
    return 0;
  }
  const db = openDatabase(dirs.dbPath);
  try {
    const files = clearWeekend(db, values.weekend);
    if (files === undefined) {
      io.err(`pitwall: no stored sessions of weekend ${values.weekend}`);
      return 1;
    }
    if (!(await processRecordings(files, db, io))) return EXIT_INTERRUPTED;
    io.out(`reprocessed ${files.length} recordings`);
    return 0;
  } finally {
    db.close();
  }
}
