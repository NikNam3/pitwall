/**
 * Most job workers that run at once across the whole bridge, every feed together.
 * Source: user rule 2026-11-13, pitwall's jobs may use up to 8 cores at runtime.
 */
export const MAX_JOB_WORKERS = 8;

/** Starts a worker in a granted slot; `release` frees the slot once that worker has exited (idempotent). */
export type SlotStart = (release: () => void) => void;

/**
 * A bridge-wide count of job worker slots, shared by every runner given the same instance (C1a: one created where
 * the feeds are created and passed in). A request beyond the free slots waits in first-in-first-out order and starts
 * when a slot is released.
 */
export class WorkerLimit {
  readonly #max: number;
  #used = 0;
  readonly #waiting: SlotStart[] = [];

  constructor(max = MAX_JOB_WORKERS) {
    if (!Number.isInteger(max) || max < 1) throw new Error(`WorkerLimit: max must be a positive integer, got ${max}`);
    this.#max = max;
  }

  /**
   * Runs `start` once a slot is free: at once when one is, else after every earlier waiting request. Returns
   * `withdraw`, which removes the request while it still waits and does nothing once it started.
   */
  request(start: SlotStart): () => void {
    if (this.#used < this.#max && this.#waiting.length === 0) {
      this.#grant(start);
      return () => {};
    }
    this.#waiting.push(start);
    return () => {
      const i = this.#waiting.indexOf(start);
      if (i >= 0) this.#waiting.splice(i, 1);
    };
  }

  #grant(start: SlotStart): void {
    this.#used += 1;
    let released = false;
    start(() => {
      if (released) return;
      released = true;
      this.#used -= 1;
      this.#next();
    });
  }

  #next(): void {
    while (this.#used < this.#max) {
      const start = this.#waiting.shift();
      if (start === undefined) return;
      this.#grant(start);
    }
  }
}
