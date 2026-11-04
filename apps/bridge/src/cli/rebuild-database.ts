import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadFeatureConfig, recordingConfig, type FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import type { Logger } from '../log.ts';
import type { DataDir } from '../storage/data-dir.ts';
import { openDatabase, SCHEMA_VERSION, type Db, type StoredSessionRow } from '../storage/db.ts';
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

/** A recording and the config it is processed with. */
export type RecordingJob = { file: string; config: FeatureConfig };

/**
 * Each of `files` with the config stored next to it (read leniently, problems warned to `log`), or the current one
 * (`<dataDir>/config.json`). Throws `StartupError` for a broken config, so call it before anything is deleted.
 */
export function recordingJobs(files: readonly string[], dirs: DataDir, log: Logger): RecordingJob[] {
  const current = loadFeatureConfig(dirs.root, FEATURES);
  return files.map((file) => ({ file, config: recordingConfig(file, FEATURES, current, log) }));
}

const INCOMPLETE = 'pitwall: interrupted; the database is incomplete, run "pitwall reprocess" again';

/**
 * Runs `jobs` in order into `db`. False when `io.signal` stopped it, and the user has been told so (`interrupted`; by
 * default: the database is incomplete, run `pitwall reprocess` again).
 */
export async function processRecordings(jobs: readonly RecordingJob[], db: Db, io: CliIo, interrupted = INCOMPLETE): Promise<boolean> {
  const log = cliLogger(io, 'warn');
  for (const { file, config } of jobs) {
    try {
      await processRecording(file, db, log, io.signal, config);
    } catch (error) {
      if (!io.signal.aborted) throw error;
      io.err(interrupted);
      return false;
    }
  }
  return true;
}

/**
 * Deletes the database files and rebuilds the database from every recording. Returns the open database and the number
 * of recordings, or undefined (database closed) when `io.signal` stopped it.
 *
 * Until the last recording is in, the database is marked with `user_version` 0: a rebuild stopped by a signal, an
 * error or a crash leaves an outdated database, which `openDatabase` refuses and the next `live` rebuilds again.
 */
export async function rebuildDatabase(dirs: DataDir, io: CliIo): Promise<{ db: Db; recordings: number } | undefined> {
  const files = allRecordings(dirs.recordings);
  const jobs = recordingJobs(files, dirs, cliLogger(io, 'warn'));
  for (const suffix of ['', '-wal', '-shm']) rmSync(dirs.dbPath + suffix, { force: true });
  const db = openDatabase(dirs.dbPath);
  try {
    db.pragma('user_version = 0');
    if (!(await processRecordings(jobs, db, io))) {
      db.close();
      return undefined;
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    return { db, recordings: files.length };
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Rebuilds stored sessions from their recordings for the live bridge, which finds them incomplete in a weekend context
 * (C61): one recording at a time, each session once per run, with the config stored next to its recording (else
 * `config`). A session without a recording is left as it is (C24).
 */
export function sessionRebuilder(db: Db, config: FeatureConfig, io: CliIo): (row: StoredSessionRow) => Promise<void> {
  const log = cliLogger(io, 'warn');
  const asked = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  return (row) => {
    const path = row.pwrecPath;
    const key = `${row.sessionUid}/${row.weekendId}/${row.playerCar}`;
    if (asked.has(key)) return Promise.resolve();
    asked.add(key);
    if (path === null || !existsSync(path)) {
      log.warn({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, pwrecPath: path }, 'stored session not complete and its recording is missing: kept as it is');
      return Promise.resolve();
    }
    const rebuilt = queue.then(() => processRecording(path, db, log, io.signal, recordingConfig(path, FEATURES, config, log)));
    queue = rebuilt.catch(() => {});
    return rebuilt;
  };
}
