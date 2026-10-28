import type { SessionTime } from '@pitwall/domain';
import { historyLengths } from '../history/delta.ts';
import type { EngineState, HistoryLengths } from '../state/engine-state.ts';
import { copyPlain } from '../util/copy-plain.ts';

/**
 * The state after frame `frameId`. The append-only history is kept by its lengths only (spec 5.4); the read-only
 * weekend context is not kept at all, a restore carries the current one over.
 */
export type Snapshot = {
  frameId: number;
  sessionTime: SessionTime;
  lengths: HistoryLengths;
  state: Omit<EngineState, 'history' | 'weekend'>;
};

/**
 * How long snapshots are kept in full. The window ends at the newest snapshot; it starts at the newest snapshot
 * that is `ms` of session time or `frames` frame ids older (the frame bound holds while session time stands still).
 */
export type SnapshotWindow = { ms: number; frames: number };

/** Older than the window, one snapshot per slot of this much session time is kept: the slot's first. */
export const KEEP_OLDER_EVERY_MS = 30_000;
const slotOf = (s: Snapshot): number => Math.floor(s.sessionTime / KEEP_OLDER_EVERY_MS);

const snapshotOf = (state: EngineState, frameId: number): Snapshot => {
  const { history, weekend: _readOnly, ...rest } = state;
  return { frameId, sessionTime: state.sessionTime, lengths: historyLengths(history), state: copyPlain(rest) };
};

/**
 * The snapshots of one session. Frame ids and session times rise from one snapshot to the next, because a rewind
 * drops every snapshot after the one it restores. The first snapshot is never dropped. Every snapshot from the
 * window's start on is kept; before it, one per `KEEP_OLDER_EVERY_MS` slot, so the count grows by two a minute.
 */
export class SnapshotStore {
  readonly #window: SnapshotWindow;
  readonly #first: Snapshot;
  /** Oldest first. */
  readonly #later: Snapshot[] = [];
  /** How many of `#later` lie before the window's start and are already thinned out. */
  #thinned = 0;

  constructor(first: EngineState, frameId: number, window: SnapshotWindow) {
    this.#window = window;
    this.#first = snapshotOf(first, frameId);
  }

  get newest(): Snapshot {
    return this.#later.at(-1) ?? this.#first;
  }

  get size(): number {
    return 1 + this.#later.length;
  }

  /** The window's first snapshot. A replay never needs the frames up to it. */
  get windowStart(): Snapshot {
    return this.#later[this.#windowStartIndex()] ?? this.#first;
  }

  take(state: EngineState, frameId: number): void {
    this.#later.push(snapshotOf(state, frameId));
    this.#thinOutBeforeWindow();
  }

  /** The newest snapshot taken at or before frame `frameId`, or the first one when none is that old. */
  newestAtOrBefore(frameId: number): Snapshot {
    return this.#later.findLast((s) => s.frameId <= frameId) ?? this.#first;
  }

  /** Drops the snapshots taken after frame `frameId`, except the first one. */
  dropAfter(frameId: number): void {
    this.#later.splice(this.#later.findLastIndex((s) => s.frameId <= frameId) + 1);
    this.#thinned = Math.min(this.#thinned, this.#later.length);
  }

  /** Index in `#later` of the window's start; -1 when the start is the first snapshot. */
  #windowStartIndex(): number {
    const { sessionTime, frameId } = this.newest;
    return this.#later.findLastIndex((s) => s.sessionTime <= sessionTime - this.#window.ms || s.frameId <= frameId - this.#window.frames);
  }

  /** Of the snapshots that have newly fallen before the window's start, keeps the first one of each slot. */
  #thinOutBeforeWindow(): void {
    const start = this.#windowStartIndex();
    if (start <= this.#thinned) return;
    const lastKept = this.#later[this.#thinned - 1];
    let lastSlot = lastKept === undefined ? undefined : slotOf(lastKept);
    const keep: Snapshot[] = [];
    for (const s of this.#later.slice(this.#thinned, start)) {
      if (slotOf(s) === lastSlot) continue;
      keep.push(s);
      lastSlot = slotOf(s);
    }
    this.#later.splice(this.#thinned, start - this.#thinned, ...keep);
    this.#thinned += keep.length;
  }
}
