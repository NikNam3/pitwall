import { existsSync } from 'node:fs';
import { StartupError } from '../../startup-error.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, type Db } from '../../storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../storage/rules-version.ts';
import { WeekendRepository } from '../../storage/weekend-repository.ts';
import type { Logger } from '../../log.ts';
import { cliLogger, EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { processRecordings, recordingJobs, reprocessAll, type RecordingJob } from '../rebuild-database.ts';

/**
 * The recordings the stored sessions of one weekend came from, with their configs. Nothing is deleted: each run replaces
 * its session's log in one transaction (C24), so an interrupted reprocess leaves the old log. A missing recording or a
 * broken config stops it before anything runs. A session without a file cannot be rebuilt and is kept. Undefined when
 * none is stored.
 */
function weekendJobs(db: Db, weekendId: string, dirs: DataDir, log: Logger): RecordingJob[] | undefined {
  const sessions = new WeekendRepository(db).sessionsOf(weekendId);
  if (sessions.length === 0) return undefined;
  const paths = sessions.flatMap((s) => (s.pwrecPath === null ? [] : [s.pwrecPath]));
  const missing = paths.find((path) => !existsSync(path));
  if (missing) throw new StartupError(`recording ${missing} not found; nothing was reprocessed`);
  return recordingJobs([...new Set(paths)], dirs, log);
}

/** `pitwall reprocess [--weekend id]`: reprocesses the recordings, all of them or one weekend's, into the database. */
export async function run(_positionals: string[], values: { weekend?: string | undefined }, io: CliIo): Promise<number> {
  const dirs = dataDir(io.env);
  const version = await rulesVersion(SOURCE_ROOT);
  if (values.weekend === undefined) {
    const recordings = await reprocessAll(dirs, io, version);
    if (recordings === undefined) return EXIT_INTERRUPTED;
    io.out(`reprocessed ${recordings} recordings`);
    return 0;
  }
  const db = openDatabase(dirs.dbPath);
  try {
    const jobs = weekendJobs(db, values.weekend, dirs, cliLogger(io, 'warn'));
    if (jobs === undefined) {
      io.err(`pitwall: no stored sessions of weekend ${values.weekend}`);
      return 1;
    }
    if (!(await processRecordings(jobs, db, io, version, 'pitwall: interrupted; the sessions not reprocessed keep their stored logs'))) return EXIT_INTERRUPTED;
    io.out(`reprocessed ${jobs.length} recordings`);
    return 0;
  } finally {
    db.close();
  }
}
