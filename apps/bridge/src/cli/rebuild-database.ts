import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadFeatureConfig, recordingConfig, type FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import type { Logger } from '../log.ts';
import type { DataDir } from '../storage/data-dir.ts';
import { openDatabase, SCHEMA_VERSION, type Db, type StoredSessionRow } from '../storage/db.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';
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
export async function processRecordings(jobs: readonly RecordingJob[], db: Db, io: CliIo, rulesVersion: string, interrupted = INCOMPLETE): Promise<boolean> {
  const log = cliLogger(io, 'warn');
  for (const { file, config } of jobs) {
    try {
      await processRecording(file, db, log, io.signal, config, rulesVersion);
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
export async function rebuildDatabase(dirs: DataDir, io: CliIo, rulesVersion: string): Promise<{ db: Db; recordings: number } | undefined> {
  const files = allRecordings(dirs.recordings);
  const jobs = recordingJobs(files, dirs, cliLogger(io, 'warn'));
  for (const suffix of ['', '-wal', '-shm']) rmSync(dirs.dbPath + suffix, { force: true });
  const db = openDatabase(dirs.dbPath);
  try {
    db.pragma('user_version = 0');
    if (!(await processRecordings(jobs, db, io, rulesVersion))) {
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

const keyText = (row: StoredSessionRow): string => `${row.sessionUid}/${row.weekendId}/${row.playerCar}`;
const hasRecording = (row: StoredSessionRow): row is StoredSessionRow & { pwrecPath: string } => row.pwrecPath !== null && existsSync(row.pwrecPath);
const rowFields = (row: StoredSessionRow) => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, pwrecPath: row.pwrecPath });

/**
 * The live bridge's rebuilds of stale stored sessions (C61: a log not complete, or of another rules version) from their
 * recordings, with the config stored next to each recording (else `config`), under `rulesVersion`. Each session is
 * handled once per run: a session whose recording is missing, or whose recording no longer yields it, is kept as it is
 * (C24), never served, and warned about once.
 */
export class StaleSessions {
  readonly #db: Db;
  readonly #config: FeatureConfig;
  readonly #io: CliIo;
  readonly #rulesVersion: string;
  readonly #log: Logger;
  /** The sessions handled this run (`keyText`). */
  readonly #handled = new Set<string>();
  /** Rebuilds run one recording at a time. */
  #queue: Promise<void> = Promise.resolve();

  constructor(db: Db, config: FeatureConfig, io: CliIo, rulesVersion: string) {
    this.#db = db;
    this.#config = config;
    this.#io = io;
    this.#rulesVersion = rulesVersion;
    this.#log = cliLogger(io, 'warn');
  }

  /**
   * At bridge start, before input opens: rebuilds every stale session of the newest stored session's weekend, one
   * progress line per recording. False when `io.signal` stopped it (the sessions not rebuilt keep their stored logs and
   * stay stale), and the user has been told so.
   */
  async rebuildNewestWeekend(): Promise<boolean> {
    const repo = new WeekendRepository(this.#db, { rulesVersion: this.#rulesVersion });
    const weekendId = repo.newestWeekendId();
    if (weekendId === undefined) return true;
    const stale = repo.staleSessionsOf(weekendId).filter((row) => !this.#handled.has(keyText(row)));
    for (const row of stale) {
      this.#handled.add(keyText(row));
      if (!hasRecording(row)) this.#log.warn(rowFields(row), 'stored session stale and its recording is missing: kept, not served');
    }
    const files = [...new Set(stale.filter(hasRecording).map((row) => row.pwrecPath))];
    const rebuilt = new Set<string>();
    for (const [i, file] of files.entries()) {
      this.#io.err(`pitwall: rebuilding ${i + 1}/${files.length}: ${file}`);
      try {
        await this.#process(file);
        rebuilt.add(file);
      } catch (error) {
        if (this.#io.signal.aborted) {
          this.#io.err('pitwall: interrupted; the sessions not rebuilt keep their stored logs');
          return false;
        }
        this.#log.error({ pwrecPath: file, err: error }, 'recording not rebuilt: its stored sessions are kept, not served');
      }
    }
    // a recording that no longer yields one of its sessions
    for (const row of repo.staleSessionsOf(weekendId)) {
      if (row.pwrecPath !== null && rebuilt.has(row.pwrecPath)) this.#log.warn(rowFields(row), 'stored session not rebuilt from its recording: kept, not served');
    }
    return true;
  }

  /**
   * Rebuilds one stale session, for a first read or in the background for a session start whose weekend context skipped
   * it: queued behind the rebuilds already running.
   */
  readonly rebuild = (row: StoredSessionRow): Promise<void> => {
    if (this.#handled.has(keyText(row))) return Promise.resolve();
    this.#handled.add(keyText(row));
    if (!hasRecording(row)) {
      this.#log.warn(rowFields(row), 'stored session stale and its recording is missing: kept, not served');
      return Promise.resolve();
    }
    const path = row.pwrecPath;
    const rebuilt = this.#queue.then(() => {
      this.#io.err(`pitwall: rebuilding ${path} (a stale stored session)`);
      return this.#process(path);
    });
    this.#queue = rebuilt.catch(() => {});
    return rebuilt;
  };

  #process(file: string): Promise<void> {
    return processRecording(file, this.#db, this.#log, this.#io.signal, recordingConfig(file, FEATURES, this.#config, this.#log), this.#rulesVersion);
  }
}

/** The live bridge's rebuild of one stale stored session (`StaleSessions.rebuild`), for `WeekendRepository` and `SessionStorage`. */
export function sessionRebuilder(db: Db, config: FeatureConfig, io: CliIo, rulesVersion: string): (row: StoredSessionRow) => Promise<void> {
  return new StaleSessions(db, config, io, rulesVersion).rebuild;
}
