import { Worker } from 'node:worker_threads';
import type { Computed } from '@pitwall/contracts';
import type { Job } from '@pitwall/engine';

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
 * Runs jobs in worker threads, one at a time per job id: a newer trigger terminates the running worker of the same
 * job, and only the newest run delivers a result. Problems inside a job (throw, crash, bad input) arrive as error
 * results, never as exceptions. `close()` terminates everything and suppresses late results.
 */
export class JobRunner {
  readonly #seed: number;
  readonly #running = new Map<string, Worker>();
  readonly #listeners: Array<(result: JobResult) => void> = [];
  readonly #terminations = new Set<Promise<number>>();
  #closed = false;

  constructor({ seed }: { seed: number }) {
    this.#seed = seed;
  }

  onResult(callback: (result: JobResult) => void): void {
    this.#listeners.push(callback);
  }

  /** Runs `job` on `input`, the output of its `prepare` (the pipeline runs that as the calculator `job:<id>`). */
  trigger<In, Out>(job: Job<In, Out>, input: In, computedFor: ComputedFor): void {
    if (this.#closed) throw new Error('JobRunner closed');
    this.#discard(job.id);
    try {
      this.#start(job.id, job.module, input, computedFor);
    } catch (e) {
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

  #start(jobId: string, module: URL, input: unknown, computedFor: ComputedFor): void {
    const seed = jobSeed(this.#seed, jobId, computedFor);
    const worker = new Worker(new URL('./worker-entry.ts', import.meta.url), {
      workerData: { moduleHref: module.href, input, seed },
    });
    this.#running.set(jobId, worker);

    const finish = (outcome: WorkerMessage): void => {
      if (this.#running.get(jobId) !== worker) return; // replaced, closed or already finished
      this.#discard(jobId);
      this.#deliver(outcome.ok ? { jobId, computedFor, value: outcome.value } : { jobId, computedFor, error: outcome.error });
    };
    worker.on('message', finish);
    worker.on('error', (e) => finish({ ok: false, error: messageOf(e) }));
    worker.on('exit', (code) => finish({ ok: false, error: `worker exited with code ${code} without a result` }));
  }

  /** Forgets the run of `jobId` (so its late events are ignored) and terminates its worker. */
  #discard(jobId: string): void {
    const worker = this.#running.get(jobId);
    if (worker === undefined) return;
    this.#running.delete(jobId);
    const termination = worker.terminate();
    this.#terminations.add(termination);
    void termination.finally(() => this.#terminations.delete(termination));
  }

  #deliver(result: JobResult): void {
    for (const callback of this.#listeners) callback(result);
  }
}
