import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DataDir } from '../storage/data-dir.ts';
import { openDatabase, type Db } from '../storage/db.ts';
import { cliLogger, type CliIo } from './io.ts';
import { processRecording } from './process-recording.ts';

const RECORDING_SUFFIX = '.pwrec.gz';

/** Every recording in `recordingsDir`, in name order. */
function allRecordings(recordingsDir: string): string[] {
  return readdirSync(recordingsDir)
    .filter((name) => name.endsWith(RECORDING_SUFFIX))
    .sort()
    .map((name) => join(recordingsDir, name));
}

/**
 * Runs `files` in order into `db`. False when `io.signal` stopped it: the database is incomplete, and the user has been
 * told to run `pitwall reprocess` again.
 */
export async function processRecordings(files: readonly string[], db: Db, io: CliIo): Promise<boolean> {
  const log = cliLogger(io, 'warn');
  for (const file of files) {
    try {
      await processRecording(file, db, log, io.signal);
    } catch (error) {
      if (!io.signal.aborted) throw error;
      io.err('pitwall: interrupted; the database is incomplete, run "pitwall reprocess" again');
      return false;
    }
  }
  return true;
}

/**
 * Deletes the database files and rebuilds the database from every recording. Returns the open database and the number
 * of recordings, or undefined (database closed) when `io.signal` stopped it.
 */
export async function rebuildDatabase(dirs: DataDir, io: CliIo): Promise<{ db: Db; recordings: number } | undefined> {
  for (const suffix of ['', '-wal', '-shm']) rmSync(dirs.dbPath + suffix, { force: true });
  const db = openDatabase(dirs.dbPath);
  try {
    const files = allRecordings(dirs.recordings);
    if (!(await processRecordings(files, db, io))) {
      db.close();
      return undefined;
    }
    return { db, recordings: files.length };
  } catch (error) {
    db.close();
    throw error;
  }
}
