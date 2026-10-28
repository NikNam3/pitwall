import { setTimeout as sleepFor } from 'node:timers/promises';
import type { FeedId } from '@pitwall/domain';
import { readPwrec } from '../pwrec/reader.ts';
import { monotonicClock, type PacketSource, type RawPacket } from './packet-source.ts';

export interface PwrecSourceOptions {
  readonly feedId: FeedId;
  readonly path: string;
  /** `realtime` keeps the recorded gaps between datagrams; `asFastAsPossible` delivers without waiting. Ignored when `pacer` is given. */
  readonly mode?: 'realtime' | 'asFastAsPossible';
  /** Decides how long each record waits; it replaces `mode`. */
  readonly pacer?: Pacer;
  /** Monotonic ms clock used for pacing. Default `performance.now`. */
  readonly clock?: () => number;
  /** Waits `ms`; rejects (abort error) or resolves early once `signal` aborts. Default `timers/promises` `setTimeout`. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Holds the source back before each record after the first; `recordGapMs` is the recorded gap to the previous record. */
export interface Pacer {
  /** Resolves when the next record may go out; resolves early once `signal` aborts (the source is stopping). */
  wait(recordGapMs: number, signal: AbortSignal): Promise<void>;
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
  readonly #pacer: Pacer;
  readonly #clock: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #abort = new AbortController();
  readonly #finish: PromiseWithResolvers<void> = Promise.withResolvers();
  #started = false;
  /** The clock when the first record was read; the `realtime` pacer measures from it. */
  #firstRecordClockMs = 0;

  constructor(opts: PwrecSourceOptions) {
    this.feedId = opts.feedId;
    this.#path = opts.path;
    this.#clock = opts.clock ?? monotonicClock;
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#pacer = opts.pacer ?? (opts.mode === 'realtime' ? this.#realtimePacer() : { wait: async () => {} });
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

  /** The `realtime` mode: keeps the recorded offsets from the first record, absorbing the time processing took. */
  #realtimePacer(): Pacer {
    let elapsedMs = 0;
    return {
      wait: async (gapMs) => {
        elapsedMs += gapMs;
        const waitMs = this.#firstRecordClockMs + elapsedMs - this.#clock();
        if (waitMs > 0) await this.#waited(waitMs);
      },
    };
  }

  get #stopped(): boolean {
    return this.#abort.signal.aborted;
  }

  async #deliver(onPacket: (packet: RawPacket) => void): Promise<void> {
    let previousMs: number | undefined;
    for await (const record of readPwrec(this.#path)) {
      if (this.#stopped) return;
      if (previousMs === undefined) {
        this.#firstRecordClockMs = this.#clock();
      } else {
        await this.#pacer.wait(Math.max(0, record.t - previousMs), this.#abort.signal);
        if (this.#stopped) return;
      }
      previousMs = record.t;
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
