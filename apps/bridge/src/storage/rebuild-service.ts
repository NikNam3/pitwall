// The one rebuild service (C24, C58, C60, C61; SP4.3e spec §4.3 item 3a): it brings stored sessions to the current rules
// version when a reader needs them, never at bridge start. One job at a time, by priority, in one worker thread that only
// replays (`cli/rebuild-worker.ts`); the main thread is the database's only writer, in short transactions: the rebuilt log's
// parts into the session's staging rows, then one swap that replaces the session's log as a whole (C24). The planning
// round's replay (C62d) runs in the same worker and queue (`replayToEnd`).
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { Logger } from '../log.ts';
import type { DataDir } from './data-dir.ts';
import type { Db, SessionKey, StoredSessionRow } from './db.ts';
import { REBUILD_WORKER, type FallbackConfig, type WorkerJob, type WorkerReply } from './rebuild-messages.ts';
import type { RebuildPriority, RebuildService, ReplayJob } from './rebuild-service-types.ts';
import { StorageWriter } from './storage-writer.ts';
import { isStale, WeekendRepository } from './weekend-repository.ts';

/** One main-thread storage transaction of a rebuild: a part into the staging rows, or the swap (C24). */
export type RebuildWrite = { session: SessionKey; step: 'part' | 'swap' };

export type RebuildServiceOptions = {
  db: Db;
  /** The data dir: its `config.json` is the config of a recording without its own config sidecar (C47). */
  dataDir?: DataDir;
  /** That config itself, in place of the data dir's (`pitwall live` has it loaded). Default: the data dir's, else the defaults. */
  config?: FallbackConfig['config'];
  /** The rules version this bridge computes (C61): a session stored under another one, or not complete, is stale. */
  rulesVersion: string;
  log: Logger;
  /**
   * Runs every main-thread storage transaction of a rebuild (`write`, called exactly once). Default: runs it. The
   * tests time each one through it; the service reads no timer.
   */
  writeProbe?: (write: () => void, info: RebuildWrite) => void;
  /**
   * The sessions a feed runs now (C59): never rebuilt under it, as its recording is still being written; such a
   * session is done without. Default: none.
   */
  running?: () => ReadonlyArray<SessionKey | undefined>;
};

const RANK: Record<RebuildPriority, number> = { runningBasis: 0, planning: 1, firstRead: 2 };

const keyText = ({ sessionUid, weekendId, playerCar }: SessionKey): string => `${sessionUid}/${weekendId}/${playerCar}`;
const keyOf = ({ sessionUid, weekendId, playerCar }: SessionKey): SessionKey => ({ sessionUid, weekendId, playerCar });
const sameKey = (a: SessionKey, b: SessionKey): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;
const rowFields = (row: StoredSessionRow) =>
  ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, pwrecPath: row.pwrecPath, rulesVersion: row.rulesVersion, complete: row.complete });

/** A worker job before the service numbers it. */
type JobInput = WorkerJob extends infer J ? (J extends WorkerJob ? Omit<J, 'id'> : never) : never;

/** A queued job: its priority, its turn among equal ones, and what it does once it runs. */
type Queued = { rank: number; turn: number; run: () => Promise<void> };

/** pino's level numbers, for the worker's log lines. */
const LEVELS: Record<number, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

/** The bridge's one rebuild service (`RebuildService`). Nothing runs until a reader asks: no rebuild at start (C61). */
export function createRebuildService(o: RebuildServiceOptions): RebuildService {
  const writeProbe = o.writeProbe ?? ((write: () => void) => write());
  const fallback: FallbackConfig = { ...(o.config && { config: o.config }), ...(o.dataDir && { root: o.dataDir.root }) };
  const repo = new WeekendRepository(o.db, { rulesVersion: o.rulesVersion });
  let failedWrite: unknown;
  const writer = new StorageWriter(o.db, { rulesVersion: o.rulesVersion, onError: (error) => { failedWrite = error; } });
  /** The rebuild of each session queued or running (`keyText`): a second call shares it. */
  const pending = new Map<string, { promise: Promise<void>; queued: Queued | undefined }>();
  /** The sessions warned about or found not rebuilt this run: neither tried nor warned about again. */
  const given = new Set<string>();
  const queue: Queued[] = [];
  let turns = 0;
  let busy: Promise<void> | undefined;
  let closed = false;

  // --- the worker ---------------------------------------------------------------------------------------------------
  let worker: Worker | undefined;
  let jobs = 0;
  /** The job the worker runs now and where its replies go. */
  let current: { id: number; onReply: (reply: WorkerReply) => void } | undefined;

  const workerOf = (): Worker => {
    if (worker !== undefined) return worker;
    const made = new Worker(REBUILD_WORKER);
    made.on('message', (reply: WorkerReply) => {
      if (reply.type === 'log') return logLine(reply.line);
      if (current !== undefined && reply.id === current.id) current.onReply(reply);
    });
    made.on('error', (error) => {
      o.log.error({ err: error }, 'rebuild worker failed');
      worker = undefined;
      current?.onReply({ id: current.id, type: 'failed', error: error instanceof Error ? error.message : String(error) });
    });
    made.on('exit', () => {
      if (worker === made) worker = undefined;
      current?.onReply({ id: current.id, type: 'failed', error: 'rebuild worker exited' });
    });
    // An idle worker keeps no process alive; a job in it does (`inWorker`).
    made.unref();
    worker = made;
    return made;
  };

  const logLine = (line: string): void => {
    try {
      const { level, msg, time: _time, pid: _pid, hostname: _hostname, ...fields } = JSON.parse(line) as Record<string, unknown> & { level: number; msg?: string };
      o.log[LEVELS[level] ?? 'warn'](fields, msg ?? '');
    } catch {
      o.log.warn({ line }, 'rebuild worker wrote an unreadable log line');
    }
  };

  /** Hands `job` to the worker; `onReply` gets its replies until its `done` or `failed`, which settle the promise. */
  const inWorker = (job: JobInput, onReply: (reply: Exclude<WorkerReply, { type: 'log' | 'done' | 'failed' }>) => void): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++jobs;
      const running = workerOf();
      current = {
        id,
        onReply: (reply) => {
          if (reply.type === 'log') return;
          if (reply.type === 'done' || reply.type === 'failed') {
            current = undefined;
            running.unref();
            if (reply.type === 'done') resolve(reply.value);
            else reject(new Error(reply.error));
            return;
          }
          try {
            onReply(reply);
          } catch (error) {
            // a storage read or write failed (the database closed under a stopping bridge): the rest of this job is dropped
            o.log.error({ err: error }, 'rebuild reply not handled');
          }
        },
      };
      running.ref();
      running.postMessage({ ...job, id } as WorkerJob);
    });

  // --- the queue ----------------------------------------------------------------------------------------------------
  const enqueue = (rank: number, run: () => Promise<void>): Queued => {
    const queued = { rank, turn: turns++, run };
    queue.push(queued);
    void next();
    return queued;
  };

  /** Runs the queued jobs one at a time, the highest priority first; a running job finishes first. */
  const next = async (): Promise<void> => {
    if (busy !== undefined) return;
    queue.sort((a, b) => a.rank - b.rank || a.turn - b.turn);
    const job = queue.shift();
    if (job === undefined) return;
    busy = job.run().catch((error: unknown) => o.log.error({ err: error }, 'rebuild job failed'));
    await busy;
    busy = undefined;
    void next();
  };

  const isRunning = (key: SessionKey): boolean => (o.running?.() ?? []).some((k) => k !== undefined && sameKey(k, key));
  const staleRow = (key: SessionKey): StoredSessionRow | undefined => {
    const row = repo.sessionOf(key);
    return row !== undefined && isStale(row, o.rulesVersion) ? row : undefined;
  };

  // --- one rebuild --------------------------------------------------------------------------------------------------
  /** Rebuilds the recording of `wanted`: every stale stored session it yields is swapped in. */
  const rebuild = async (wanted: StoredSessionRow & { pwrecPath: string }): Promise<void> => {
    // Checked when it starts: current meanwhile (another rebuild of its recording), or run by a feed now.
    if (staleRow(wanted) === undefined || isRunning(wanted)) return;
    /** The sessions of the recording being staged: each swapped at its end when it is still stale. */
    const staged = new Map<string, StoredSessionRow>();
    const swapped: SessionKey[] = [];
    const write = (session: SessionKey, step: RebuildWrite['step'], fn: () => void): boolean => {
      failedWrite = undefined;
      let error: unknown;
      writeProbe(() => {
        try {
          fn();
        } catch (e) {
          error = e;
        }
      }, { session: keyOf(session), step });
      if (error === undefined && failedWrite === undefined) return true;
      o.log.error({ sessionUid: session.sessionUid, weekendId: session.weekendId, playerCar: session.playerCar, err: error ?? failedWrite }, 'rebuild not written: the stored session is kept');
      return false;
    };
    const drop = (key: SessionKey): void => {
      staged.delete(keyText(key));
      try {
        writer.dropStaged(key);
      } catch (error) {
        o.log.error({ err: error }, 'staging rows not dropped');
      }
    };
    try {
      await inWorker({ kind: 'rebuild', pwrecPath: wanted.pwrecPath, fallback, rulesVersion: o.rulesVersion }, (reply) => {
        if (reply.type === 'session') {
          // Only a stored stale session no feed runs is rebuilt; any other the recording yields is left as it is.
          if (staleRow(reply.row) === undefined || isRunning(reply.row)) return;
          writer.dropStaged(reply.row);
          staged.set(keyText(reply.row), reply.row);
        } else if (reply.type === 'part') {
          if (!staged.has(keyText(reply.key))) return;
          if (!write(reply.key, 'part', () => writer.stagePart(reply.key, reply.rows))) drop(reply.key);
        } else {
          const row = staged.get(keyText(reply.key));
          if (row === undefined) return;
          staged.delete(keyText(reply.key));
          if (staleRow(row) === undefined || isRunning(row)) return drop(row);
          // A recording replayed to its end on which no session runs is complete, end signal or not (C61).
          if (write(row, 'swap', () => writer.swapStaged(row, o.rulesVersion, { complete: row.complete }))) swapped.push(keyOf(row));
          else drop(row);
        }
      });
    } catch (error) {
      o.log.error({ pwrecPath: wanted.pwrecPath, err: error }, 'recording not rebuilt: its stored sessions are kept, not served');
    } finally {
      for (const row of [...staged.values()]) drop(row);
    }
    if (!swapped.some((k) => sameKey(k, wanted))) {
      given.add(keyText(wanted));
      o.log.info(rowFields(wanted), 'stored session not rebuilt from its recording: kept, not served');
    }
  };

  /** The rebuild of one stale session, shared by every caller; `undefined` when it is done without at once. */
  const rebuildOf = (row: StoredSessionRow, rank: number): Promise<void> | undefined => {
    const text = keyText(row);
    if (given.has(text)) return undefined;
    const known = pending.get(text);
    if (known !== undefined) {
      // asked again with a higher priority while it waits: it moves up
      if (known.queued !== undefined && rank < known.queued.rank) known.queued.rank = rank;
      return known.promise;
    }
    if (row.pwrecPath === null || !existsSync(row.pwrecPath)) {
      given.add(text);
      o.log.warn(rowFields(row), 'stored session stale and its recording is missing: kept, not served');
      return undefined;
    }
    const withRecording = { ...row, pwrecPath: row.pwrecPath };
    const entry: { promise: Promise<void>; queued: Queued | undefined } = { promise: Promise.resolve(), queued: undefined };
    entry.promise = new Promise<void>((resolve) => {
      entry.queued = enqueue(rank, async () => {
        entry.queued = undefined;
        try {
          await rebuild(withRecording);
        } finally {
          pending.delete(text);
          resolve();
        }
      });
    });
    pending.set(text, entry);
    return entry.promise;
  };

  return {
    async ensureCurrent(refs, opts = {}) {
      const rank = RANK[opts.priority ?? 'firstRead'];
      const stale = refs.flatMap((ref) => {
        const row = staleRow(ref);
        return row === undefined || isRunning(row) || closed ? [] : [row];
      });
      const unique = stale.filter((row, i) => stale.findIndex((r) => sameKey(r, row)) === i);
      let done = 0;
      opts.onProgress?.(0, unique.length);
      await Promise.all(unique.map(async (row) => {
        await rebuildOf(row, rank);
        opts.onProgress?.(++done, unique.length);
      }));
    },

    replayToEnd<T>(job: ReplayJob, priority: RebuildPriority): Promise<T> {
      if (closed) return Promise.reject(new Error('rebuild service closed'));
      return new Promise<T>((resolve, reject) => {
        enqueue(RANK[priority], async () => {
          try {
            const dbPath = o.db.memory ? undefined : o.db.name;
            resolve((await inWorker({ kind: 'replay', job, fallback, rulesVersion: o.rulesVersion, dbPath }, () => {})) as T);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    },

    async close() {
      closed = true;
      queue.length = 0;
      await busy;
      for (const entry of pending.values()) entry.queued = undefined;
      const stopping = worker;
      worker = undefined;
      await stopping?.terminate();
    },
  };
}
