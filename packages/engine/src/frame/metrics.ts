import type { SessionTime } from '@pitwall/domain';

/** Feed health counters; consumers: session tracker, scheduler feed view, bridge monitor. */
export type FrameMetrics = {
  framesClosed: number;
  /** Closed frames missing a menu-rate packet. */
  incompleteFrames: number;
  /** Packets dropped because their frame was already closed. */
  latePackets: number;
  /** Counted by the session tracker: packets before the first Session packet. */
  droppedBeforeSession: number;
  /** Counted by the session tracker: `sessionUid = 0` packets outside a grace window. */
  droppedUid0: number;
  /** Counted by the bridge. */
  decodeErrors: number;
  lastSessionTime?: SessionTime;
  /** Median session-time step between frames. */
  cadenceMs?: number;
};

export const emptyMetrics = (): FrameMetrics => ({
  framesClosed: 0,
  incompleteFrames: 0,
  latePackets: 0,
  droppedBeforeSession: 0,
  droppedUid0: 0,
  decodeErrors: 0,
});

const CADENCE_SAMPLES = 64;

/** Median of the last positive session-time steps; zero and negative steps (pause, flashback) are skipped. */
export class CadenceTracker {
  #steps: number[] = [];
  #last: SessionTime | undefined;

  get lastSessionTime(): SessionTime | undefined {
    return this.#last;
  }

  /** The median step, or `undefined` before the first positive step. */
  get medianMs(): number | undefined {
    if (this.#steps.length === 0) return undefined;
    const sorted = [...this.#steps].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  record(sessionTime: SessionTime): void {
    if (this.#last !== undefined && sessionTime > this.#last) {
      this.#steps.push(sessionTime - this.#last);
      if (this.#steps.length > CADENCE_SAMPLES) this.#steps.shift();
    }
    this.#last = sessionTime;
  }
}
