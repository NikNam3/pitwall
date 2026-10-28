import { existsSync } from 'node:fs';
import { StartupError } from '../../startup-error.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, type Db } from '../../storage/db.ts';
import { StorageWriter } from '../../storage/storage-writer.ts';
import { WeekendRepository } from '../../storage/weekend-repository.ts';
import type { Logger } from '../../log.ts';
import { cliLogger, EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { processRecordings, rebuildDatabase, recordingJobs, type RecordingJob } from '../rebuild-database.ts';

/**
 * The recordings the stored sessions of one weekend came from, with their configs, after deleting the sessions they
 * rebuild, so the new run leaves no stale rows. A missing recording or a broken config stops it before anything is deleted. A session without a file cannot be rebuilt and is kept. Undefined when none is stored.
 */
function clearWeekend(db: Db, weekendId: string, dirs: DataDir, log: Logger): RecordingJob[] | undefined {
  const sessions = new WeekendRepository(db).sessionsOf(weekendId);
  if (sessions.length === 0) return undefined;
  const rebuilt = sessions.flatMap((s) => (s.pwrecPath === null ? [] : [{ sessionUid: s.sessionUid, path: s.pwrecPath }]));
  const missing = rebuilt.find(({ path }) => !existsSync(path));
  if (missing) throw new StartupError(`recording ${missing.path} not found; nothing was deleted`);
  const jobs = recordingJobs([...new Set(rebuilt.map(({ path }) => path))], dirs, log);
  // unlike the live feed, a failed delete stops the command
  const writer = new StorageWriter(db, {
    onError: (error) => {
      throw error;
    },
  });
  writer.deleteSessions(rebuilt.map(({ sessionUid }) => sessionUid));
  return jobs;
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
    const jobs = clearWeekend(db, values.weekend, dirs, cliLogger(io, 'warn'));
    if (jobs === undefined) {
      io.err(`pitwall: no stored sessions of weekend ${values.weekend}`);
      return 1;
    }
    if (!(await processRecordings(jobs, db, io))) return EXIT_INTERRUPTED;
    io.out(`reprocessed ${jobs.length} recordings`);
    return 0;
  } finally {
    db.close();
  }
}
