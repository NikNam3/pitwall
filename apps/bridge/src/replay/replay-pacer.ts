import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Pacer } from '../input/pwrec-source.ts';
import type { FeedPosition } from '../pipeline/feed-pipeline.ts';

/** Where a fast-forward stops: the first frame at or past it. */
export type SeekTarget = { kind: 'lap'; lap: number } | { kind: 'time'; sessionTimeMs: number };

export type ReplayPacerOptions = {
  /** Waits `ms`; resolves or rejects once `signal` aborts. Default `timers/promises` `setTimeout`. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Where the replay is now (the current pipeline's position). */
  position: () => FeedPosition | undefined;
  /** Start without waiting between records (a fast replay); the first speed change turns the recorded pace on. */
  unpaced?: boolean;
  /** Called before every record, so the owner can publish progress. */
  onRecord: () => void;
  /** Called when a fast-forward reached its target. */
  onSeekDone: () => void;
};

/** Timers cannot honour less; shorter gaps are carried over and slept together with the following ones. */
const MIN_SLEEP_MS = 1;

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> => sleepFor(ms, undefined, { signal });

/**
 * The replay's clock, shared by every source of one replay: waits the recorded gap divided by the speed while
 * playing, holds while paused, and lets records through without waiting while fast-forwarding to a target.
 */
export class ReplayPacer implements Pacer {
  #paused = false;
  #speed = 1;
  #unpaced: boolean;
  /** Gap time not slept yet. */
  #owedMs = 0;
  #seek: SeekTarget | undefined;
  /** Wake-ups of the waits in flight; a state change that matters to a wait calls them. */
  readonly #wakers = new Set<() => void>();
  readonly #o: Required<ReplayPacerOptions>;

  constructor(opts: ReplayPacerOptions) {
    this.#o = { sleep: defaultSleep, unpaced: false, ...opts };
    this.#unpaced = this.#o.unpaced;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get speed(): number {
    return this.#speed;
  }

  get seeking(): boolean {
    return this.#seek !== undefined;
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    this.wake();
  }

  setSpeed(factor: number): void {
    this.#speed = factor;
    this.#unpaced = false;
  }

  /** Fast-forwards until `position()` reaches `target`, then goes back to the paused or playing state. */
  seekTo(target: SeekTarget): void {
    this.#seek = target;
    this.wake();
  }

  /** Gives up the fast-forward without reaching its target (the recording ended). */
  cancelSeek(): void {
    this.#seek = undefined;
  }

  /** Whether the position has reached the fast-forward target. */
  reachedTarget(): boolean {
    const target = this.#seek;
    const position = this.#o.position();
    if (target === undefined || position === undefined) return false;
    return target.kind === 'time' ? position.sessionTimeMs >= target.sessionTimeMs : position.playerLap >= target.lap;
  }

  /** Lets every wait in flight look at the state again (a stopping source calls it through its abort signal). */
  wake(): void {
    for (const wake of [...this.#wakers]) wake();
  }

  async wait(recordGapMs: number, signal: AbortSignal): Promise<void> {
    this.#o.onRecord();
    if (this.#seek !== undefined) {
      if (!this.reachedTarget()) return;
      this.#seek = undefined;
      this.#o.onSeekDone();
    }
    await this.#holdWhilePaused(signal);
    if (!this.#unpaced && this.#seek === undefined && !signal.aborted && !(this.#paused && this.#o.position() === undefined)) {
      this.#owedMs += recordGapMs / this.#speed;
      if (this.#owedMs >= MIN_SLEEP_MS) {
        const ms = this.#owedMs;
        this.#owedMs = 0;
        await this.#sleep(ms, signal);
      }
    }
    await this.#holdWhilePaused(signal);
  }

  async #holdWhilePaused(signal: AbortSignal): Promise<void> {
    // Before the first frame there is nothing to stay on: a pause takes hold from the first frame on.
    while (this.#paused && this.#o.position() !== undefined && this.#seek === undefined && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          this.#wakers.delete(done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        this.#wakers.add(done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  /** Sleeps, cut short by the source stopping or by a pause or fast-forward starting. */
  async #sleep(ms: number, signal: AbortSignal): Promise<void> {
    const interrupt = new AbortController();
    const wake = (): void => interrupt.abort();
    this.#wakers.add(wake);
    try {
      await this.#o.sleep(ms, AbortSignal.any([signal, interrupt.signal]));
    } catch (error) {
      if (!signal.aborted && !interrupt.signal.aborted) throw error;
    } finally {
      this.#wakers.delete(wake);
    }
  }
}
