import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadFeatureConfig, recordingConfig, type FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import type { Logger } from '../log.ts';
import type { DataDir } from '../storage/data-dir.ts';
import { openDatabase, SCHEMA_VERSION, SchemaVersionError, type Db, type StoredSessionRow } from '../storage/db.ts';
import { createRebuildService } from '../storage/rebuild-service.ts';
import type { RebuildService } from '../storage/rebuild-service-types.ts';
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

/** A rebuild's progress: `done` of `total` recordings finished. */
export type RebuildProgress = (done: number, total: number) => void;

/**
 * Runs `jobs` in order into `db`, reporting `onProgress` before the first and after each recording. False when
 * `io.signal` stopped it, and the user has been told so (`interrupted`; by default: the database is incomplete, run
 * `pitwall reprocess` again).
 */
export async function processRecordings(
  jobs: readonly RecordingJob[],
  db: Db,
  io: CliIo,
  rulesVersion: string,
  interrupted = INCOMPLETE,
  onProgress?: RebuildProgress,
): Promise<boolean> {
  const log = cliLogger(io, 'warn');
  onProgress?.(0, jobs.length);
  for (const [i, { file, config }] of jobs.entries()) {
    try {
      await processRecording(file, db, log, io.signal, config, rulesVersion);
    } catch (error) {
      if (!io.signal.aborted) throw error;
      io.err(interrupted);
      return false;
    }
    onProgress?.(i + 1, jobs.length);
  }
  return true;
}

/**
 * Deletes the database files and rebuilds the database from every recording. Returns the open database and the number
 * of recordings, or undefined (database closed) when `io.signal` stopped it.
 *
 * Until the last recording is in, the database is marked with `user_version` 0: a rebuild stopped by a signal, an
 * error or a crash leaves an outdated database, which `openDatabase` refuses and the next `live` rebuilds again.
 * `onProgress` reports the recordings finished (`processRecordings`).
 */
export async function rebuildDatabase(
  dirs: DataDir,
  io: CliIo,
  rulesVersion: string,
  onProgress?: RebuildProgress,
): Promise<{ db: Db; recordings: number } | undefined> {
  const files = allRecordings(dirs.recordings);
  const jobs = recordingJobs(files, dirs, cliLogger(io, 'warn'));
  for (const suffix of ['', '-wal', '-shm']) rmSync(dirs.dbPath + suffix, { force: true });
  const db = openDatabase(dirs.dbPath);
  try {
    db.pragma('user_version = 0');
    if (!(await processRecordings(jobs, db, io, rulesVersion, INCOMPLETE, onProgress))) {
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
 * `pitwall reprocess` of every recording. On a database of the current schema nothing is deleted (C24): every recording
 * runs into the open database, each session's log replaced in one transaction, so an interrupted run leaves the
 * sessions it did not reach as they were, and a session without a recording is kept. Only a missing database or one of
 * an older schema (which cannot be read) is rebuilt from scratch (`rebuildDatabase`). Returns the number of recordings,
 * or undefined when `io.signal` stopped it (the user has been told).
 */
export async function reprocessAll(dirs: DataDir, io: CliIo, rulesVersion: string): Promise<number | undefined> {
  const current = existsSync(dirs.dbPath) ? openCurrent(dirs.dbPath) : undefined;
  if (current === undefined) {
    const rebuilt = await rebuildDatabase(dirs, io, rulesVersion);
    rebuilt?.db.close();
    return rebuilt?.recordings;
  }
  try {
    const files = allRecordings(dirs.recordings);
    const jobs = recordingJobs(files, dirs, cliLogger(io, 'warn'));
    const done = await processRecordings(jobs, current, io, rulesVersion, 'pitwall: interrupted; the sessions not reprocessed keep their stored logs');
    return done ? files.length : undefined;
  } finally {
    current.close();
  }
}

/** The database at `path` when it has the current schema; undefined for an older one. */
function openCurrent(path: string): Db | undefined {
  try {
    return openDatabase(path);
  } catch (error) {
    if (error instanceof SchemaVersionError) return undefined;
    throw error;
  }
}

/**
 * The live bridge's rebuilds of stale stored sessions (C61: a log not complete, or of another rules version) from their
 * recordings, with the config stored next to each recording (else `config`), under `rulesVersion`: it delegates to the
 * one rebuild service (`createRebuildService`), which rebuilds nothing until a reader asks (none at bridge start).
 */
export class StaleSessions {
  readonly #io: CliIo;
  readonly #service: RebuildService;

  constructor(db: Db, config: FeatureConfig, io: CliIo, rulesVersion: string) {
    this.#io = io;
    this.#service = createRebuildService({ db, config, rulesVersion, log: cliLogger(io, 'warn') });
  }
  /**
   * Rebuilds one stale session (C61), for a first read or in the background for a session start whose weekend context
   * skipped it: through the one rebuild service, one session at a time. A session whose recording is missing, or whose
   * recording no longer yields it, is kept as it is (C24), never served, and warned about once.
   */
  readonly rebuild = (row: StoredSessionRow): Promise<void> => {
    if (row.pwrecPath !== null && existsSync(row.pwrecPath)) this.#io.err(`pitwall: rebuilding ${row.pwrecPath} (a stale stored session)`);
    return this.#service.ensureCurrent([row]);
  };

  /** Finishes the session being rebuilt and stops the service's worker. */
  close(): Promise<void> {
    return this.#service.close();
  }
}

/** The live bridge's rebuild of one stale stored session (`StaleSessions.rebuild`), for `WeekendRepository` and `SessionStorage`. */
export function sessionRebuilder(db: Db, config: FeatureConfig, io: CliIo, rulesVersion: string): (row: StoredSessionRow) => Promise<void> {
  return new StaleSessions(db, config, io, rulesVersion).rebuild;
}
