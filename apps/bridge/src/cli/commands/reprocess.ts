import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../../storage/data-dir.ts';
import { openDatabase, type Db } from '../../storage/db.ts';
import { WeekendRepository } from '../../storage/weekend-repository.ts';
import { cliLogger, type CliIo } from '../io.ts';
import { processRecording } from '../process-recording.ts';

const RECORDING_SUFFIX = '.pwrec.gz';

function allRecordings(recordingsDir: string): string[] {
  return readdirSync(recordingsDir)
    .filter((name) => name.endsWith(RECORDING_SUFFIX))
    .sort()
    .map((name) => join(recordingsDir, name));
}

/** The recordings the stored sessions of one weekend came from (a session without a file has none). */
function recordingsOf(db: Db, weekendId: string): string[] {
  const paths = new WeekendRepository(db).sessionsOf(weekendId).flatMap((session) => (session.pwrecPath === null ? [] : [session.pwrecPath]));
  return [...new Set(paths)];
}

/** `pitwall reprocess [--weekend id]`: rebuilds the database from the recordings, all of them or one weekend's. */
export async function run(_positionals: string[], values: { weekend?: string | undefined }, io: CliIo): Promise<number> {
  const dirs = dataDir(io.env);
  if (values.weekend === undefined) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(dirs.dbPath + suffix, { force: true });
  }
  const db = openDatabase(dirs.dbPath);
  try {
    const files = values.weekend === undefined ? allRecordings(dirs.recordings) : recordingsOf(db, values.weekend);
    const log = cliLogger(io, 'warn');
    for (const file of files) await processRecording(file, db, log);
    io.out(`reprocessed ${files.length} recordings`);
    return 0;
  } finally {
    db.close();
  }
}
