import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { Worker } from 'node:worker_threads';
import type { EngineView, Job } from '@pitwall/engine/readers';
import type { Feature } from '../features/feature.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import { RECORDING_FEED } from './process-recording.ts';

/**
 * Whether a job run is under way: a CLI command that waits for a job's result (`pitwall score`, `pitwall strategy`)
 * holds the recording back while one is, so the session's end never cancels it (`FeedJobs.sessionEnded`). A run starts
 * when its trigger calculator ran (the job's `prepare`); the job runner then starts its worker in the same frame. It
 * ends with the next message on the subscription (its result, or the topic marked errored) and its worker's exit: a run
 * that is cancelled (a flashback or the session's end terminates its worker, ruling R33) delivers nothing, but its
 * worker exits, so the recording goes on. Only the workers started while a run is asked for are the job's (the command
 * subscribes to no other job's topic, C49).
 */
export class JobGate {
  /** A run was asked for and its worker has not started yet. */
  #asked = false;
  readonly #workers = new Set<Worker>();
  #waiting: Array<() => void> = [];
  readonly #onWorker = (message: unknown): void => {
    const worker = (message as { worker: Worker }).worker;
    if (!this.#asked) return;
    this.#asked = false;
    this.#workers.add(worker);
    worker.once('exit', () => {
      this.#workers.delete(worker);
      this.#settle();
    });
  };

  constructor() {
    subscribe('worker_threads', this.#onWorker);
  }

  started(): void {
    this.#asked = true;
  }

  /** A message on the subscription: the run asked for delivered (or never got a worker and failed). */
  ended(): void {
    this.#asked = false;
    this.#settle();
  }

  /** Stops watching the workers. */
  close(): void {
    unsubscribe('worker_threads', this.#onWorker);
  }

  get #running(): boolean {
    return this.#asked || this.#workers.size > 0;
  }

  #settle(): void {
    if (this.#running) return;
    for (const resolve of this.#waiting.splice(0)) resolve();
  }

  /** Resolves once no run is under way, or once `signal` aborts. */
  idle(signal: AbortSignal): Promise<void> {
    if (!this.#running || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      this.#waiting.push(done);
      signal.addEventListener('abort', done, { once: true });
    });
  }
}

/** The recording, as fast as possible, each record (and the end of the input) held back while a job is under way. */
export class GatedSource implements PacketSource {
  readonly feedId = RECORDING_FEED;
  readonly done: Promise<void>;
  readonly #inner: PwrecSource;
  readonly #stopping = new AbortController();
  #inputEnded = false;

  constructor(path: string, gate: JobGate) {
    this.#inner = new PwrecSource({ feedId: RECORDING_FEED, path, pacer: { wait: (_gapMs, signal) => gate.idle(signal) } });
    this.done = this.#inner.done.then(() => {
      this.#inputEnded = true;
      return gate.idle(this.#stopping.signal);
    });
    this.done.catch(() => {});
  }

  /** Every record of the recording was read (what follows is the session's end). */
  get inputEnded(): boolean {
    return this.#inputEnded;
  }

  start(onPacket: (packet: RawPacket) => void): void {
    this.#inner.start(onPacket);
  }

  async stop(): Promise<void> {
    this.#stopping.abort();
    await this.#inner.stop();
    await this.done.catch(() => {});
  }
}

/** The features, the `jobId` job's `prepare` calling `onPrepare` with its view and then telling `gate` that a run starts. */
export function gatedFeatures(features: readonly Feature[], jobId: string, gate: JobGate, onPrepare: (view: EngineView) => void = () => {}): Feature[] {
  const gated = (job: Job<unknown, unknown>): Job<unknown, unknown> =>
    job.id !== jobId
      ? job
      : {
          ...job,
          prepare: (view) => {
            const input = job.prepare(view);
            onPrepare(view);
            gate.started();
            return input;
          },
        };
  return features.map((feature) => (feature.jobs === undefined ? feature : { ...feature, jobs: feature.jobs.map(gated) }));
}
