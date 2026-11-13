import { Worker } from 'node:worker_threads';
import type { Computed } from '@pitwall/contracts';
import type { Job } from '@pitwall/engine/readers';
import { WorkerLimit } from './worker-limit.ts';

/** Where a result was computed: the player's lap and the frame that triggered the job. */
export type ComputedFor = Computed<unknown>['computedFor'];

export type JobResult =
  | { jobId: string; computedFor: ComputedFor; value: unknown }
  | { jobId: string; computedFor: ComputedFor; error: string };

/** What `worker-entry.ts` posts to the parent. */
export type WorkerMessage = { ok: true; value: unknown } | { ok: false; error: string };

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Seed of one job run: FNV-1a (32 bit, unsigned) over the UTF-8 string `seed:jobId:lap:frameId`. */
export function jobSeed(seed: number, jobId: string, computedFor: ComputedFor): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(`${seed}:${jobId}:${computedFor.lap}:${computedFor.frameId}`)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME);
  }
  return hash >>> 0;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One trigger of a job: one worker per started part, the withdrawals of the parts' worker-slot requests (a no-op once
 * a part started), and the outputs of the parts that finished, by part index.
 */
type Run = { workers: Worker[]; withdrawals: Array<() => void>; outs: unknown[]; remaining: number };

/**
 * Runs jobs in worker threads, one run at a time per job id: a newer trigger terminates every running worker of the
 * same job, and only the newest run delivers a result. A job with `parts` runs every part at once, one worker each,
 * and delivers one result, the merge of the parts' outputs in the parts' order. Problems inside a job (throw, crash,
 * bad input, a failing split or merge) arrive as error results, never as exceptions; a failing part terminates the
 * other parts of its run. Every worker takes a slot of the runner's `WorkerLimit` (shared by every runner given the
 * same instance; without one the runner gets its own of `MAX_JOB_WORKERS`) and frees it when it exits; a part beyond
 * the free slots waits, first in first out, with the seed it gets anyway. A newer trigger and `cancel()` also drop
 * the waiting parts. `close()` terminates everything, drops every waiting part and suppresses late results.
 */
export class JobRunner {
  readonly #seed: number;
  readonly #limit: WorkerLimit;
  readonly #running = new Map<string, Run>();
  readonly #listeners: Array<(result: JobResult) => void> = [];
  readonly #terminations = new Set<Promise<number>>();
  #closed = false;

  constructor({ seed, limit }: { seed: number; limit?: WorkerLimit }) {
    this.#seed = seed;
    this.#limit = limit ?? new WorkerLimit();
  }

  onResult(callback: (result: JobResult) => void): void {
    this.#listeners.push(callback);
  }

  /** Runs `job` on `input`, the output of its `prepare` (the pipeline runs that as the calculator `job:<id>`). */
  trigger<In, Out>(job: Job<In, Out>, input: In, computedFor: ComputedFor): void {
    if (this.#closed) throw new Error('JobRunner closed');
    this.#discard(job.id);
    try {
      this.#start(job, input, computedFor);
    } catch (e) {
      this.#discard(job.id);
      this.#deliver({ jobId: job.id, computedFor, error: messageOf(e) });
    }
  }

  /** Terminates the running workers; their results are never delivered. The runner still takes new triggers. */
  cancel(): void {
    for (const id of [...this.#running.keys()]) this.#discard(id);
  }

  /** Terminates all running workers and resolves once they are gone. No result is delivered afterwards. */
  async close(): Promise<void> {
    this.#closed = true;
    this.cancel();
    await Promise.all(this.#terminations);
  }

  #start<In, Out>(job: Job<In, Out>, input: In, computedFor: ComputedFor): void {
    const jobId = job.id;
    const parts = job.parts === undefined ? [input] : job.parts.split(input);
    if (parts.length === 0) throw new Error(`job ${jobId}: split returned no part`);
    const run: Run = { workers: [], withdrawals: [], outs: new Array<unknown>(parts.length), remaining: parts.length };
    this.#running.set(jobId, run);

    const result = (): JobResult => {
      if (job.parts === undefined) return { jobId, computedFor, value: run.outs[0] };
      try {
        return { jobId, computedFor, value: job.parts.merge(run.outs as Out[]) };
      } catch (e) {
        return { jobId, computedFor, error: messageOf(e) };
      }
    };

    parts.forEach((part, i) => {
      if (this.#running.get(jobId) !== run) return; // an earlier part already failed
      const seed = jobSeed(this.#seed, job.parts === undefined ? jobId : `${jobId}/${i}`, computedFor);
      let settled = false;
      const finish = (outcome: WorkerMessage): void => {
        if (settled || this.#running.get(jobId) !== run) return; // replaced, closed, failed or already finished
        settled = true;
        if (!outcome.ok) {
          this.#discard(jobId);
          this.#deliver({ jobId, computedFor, error: outcome.error });
          return;
        }
        run.outs[i] = outcome.value;
        run.remaining -= 1;
        if (run.remaining > 0) return;
        this.#discard(jobId);
        this.#deliver(result());
      };

      run.withdrawals.push(this.#limit.request((release) => {
        if (this.#running.get(jobId) !== run) { release(); return; } // its run was dropped while it waited
        let worker: Worker;
        try {
          worker = new Worker(new URL('./worker-entry.ts', import.meta.url), {
            workerData: { moduleHref: job.module.href, input: part, seed },
          });
        } catch (e) {
          release();
          finish({ ok: false, error: messageOf(e) });
          return;
        }
        worker.once('exit', release);
        run.workers.push(worker);
        worker.on('message', finish);
        worker.on('error', (e) => finish({ ok: false, error: messageOf(e) }));
        worker.on('exit', (code) => finish({ ok: false, error: `worker exited with code ${code} without a result` }));
      }));
    });
  }

  /** Forgets the run of `jobId` (so its late events are ignored), drops its waiting parts and terminates its workers. */
  #discard(jobId: string): void {
    const run = this.#running.get(jobId);
    if (run === undefined) return;
    this.#running.delete(jobId);
    for (const withdraw of run.withdrawals) withdraw();
    for (const worker of run.workers) {
      const termination = worker.terminate();
      this.#terminations.add(termination);
      void termination.finally(() => this.#terminations.delete(termination));
    }
  }

  #deliver(result: JobResult): void {
    for (const callback of this.#listeners) callback(result);
  }
}
