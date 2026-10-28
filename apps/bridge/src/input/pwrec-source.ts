import { setTimeout as sleepFor } from 'node:timers/promises';
import type { FeedId } from '@pitwall/domain';
import { readPwrec } from '../pwrec/reader.ts';
import { monotonicClock, type PacketSource, type RawPacket } from './packet-source.ts';

export interface PwrecSourceOptions {
  readonly feedId: FeedId;
  readonly path: string;
  /** `realtime` keeps the recorded gaps between datagrams; `asFastAsPossible` delivers without waiting. */
  readonly mode: 'realtime' | 'asFastAsPossible';
  /** Monotonic ms clock used for pacing. Default `performance.now`. */
  readonly clock?: () => number;
  /** Waits `ms`; rejects (abort error) or resolves early once `signal` aborts. Default `timers/promises` `setTimeout`. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> => sleepFor(ms, undefined, { signal });

/**
 * Replays a `.pwrec.gz` recording. `receivedAtMs` is the record's `t`, in both modes.
 * `done` rejects with `PwrecFormatError` for an invalid file, or with the read error (e.g. corrupt gzip).
 */
export class PwrecSource implements PacketSource {
  readonly feedId: FeedId;
  readonly done: Promise<void>;
  readonly #path: string;
  readonly #realtime: boolean;
  readonly #clock: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #abort = new AbortController();
  readonly #finish: PromiseWithResolvers<void> = Promise.withResolvers();
  #started = false;

  constructor(opts: PwrecSourceOptions) {
    this.feedId = opts.feedId;
    this.#path = opts.path;
    this.#realtime = opts.mode === 'realtime';
    this.#clock = opts.clock ?? monotonicClock;
    this.#sleep = opts.sleep ?? defaultSleep;
    this.done = this.#finish.promise;
    this.done.catch(() => {});
  }

  start(onPacket: (packet: RawPacket) => void): void {
    if (this.#started) throw new Error('PwrecSource: already started');
    this.#started = true;
    this.#deliver(onPacket).then(this.#finish.resolve, this.#finish.reject);
  }

  async stop(): Promise<void> {
    this.#abort.abort();
    if (!this.#started) {
      this.#started = true;
      this.#finish.resolve();
    }
    await this.done.catch(() => {});
  }

  get #stopped(): boolean {
    return this.#abort.signal.aborted;
  }

  async #deliver(onPacket: (packet: RawPacket) => void): Promise<void> {
    let origin: { readonly clockMs: number; readonly recordMs: number } | undefined;
    for await (const record of readPwrec(this.#path)) {
      if (this.#stopped) return;
      if (this.#realtime) {
        origin ??= { clockMs: this.#clock(), recordMs: record.t };
        const waitMs = origin.clockMs + (record.t - origin.recordMs) - this.#clock();
        if (waitMs > 0 && !(await this.#waited(waitMs))) return;
      }
      onPacket({ feedId: this.feedId, receivedAtMs: record.t, bytes: record.payload });
    }
  }

  /** Sleeps `ms`. False when `stop()` interrupted the wait or came in during it. */
  async #waited(ms: number): Promise<boolean> {
    try {
      await this.#sleep(ms, this.#abort.signal);
    } catch (error) {
      if (!this.#stopped) throw error;
    }
    return !this.#stopped;
  }
}
