import type { SessionTime } from '@pitwall/domain';
import { historyLengths } from '../history/delta.ts';
import type { EngineState, HistoryLengths } from '../state/engine-state.ts';

/** The state after frame `frameId`. The append-only history is kept by its lengths only (spec 5.4). */
export type Snapshot = { frameId: number; sessionTime: SessionTime; lengths: HistoryLengths; state: Omit<EngineState, 'history'> };

const snapshotOf = (state: EngineState, frameId: number): Snapshot => {
  const { history, ...rest } = state;
  return { frameId, sessionTime: state.sessionTime, lengths: historyLengths(history), state: structuredClone(rest) };
};

/**
 * The snapshots of one session. Frame ids and session times rise from one snapshot to the next, because a rewind
 * drops every snapshot after the one it restores. The first snapshot is never dropped.
 */
export class SnapshotStore {
  readonly #first: Snapshot;
  /** Oldest first. */
  readonly #later: Snapshot[] = [];

  constructor(first: EngineState, frameId: number) {
    this.#first = snapshotOf(first, frameId);
  }

  get newest(): Snapshot {
    return this.#later.at(-1) ?? this.#first;
  }

  take(state: EngineState, frameId: number): void {
    this.#later.push(snapshotOf(state, frameId));
  }

  /** The newest snapshot taken at or before frame `frameId`, or the first one when none is that old. */
  newestAtOrBefore(frameId: number): Snapshot {
    return this.#later.findLast((s) => s.frameId <= frameId) ?? this.#first;
  }

  /** The newest snapshot taken at or before session time `t`, or the first one when none is that old. */
  newestAtOrBeforeTime(t: SessionTime): Snapshot {
    return this.#later.findLast((s) => s.sessionTime <= t) ?? this.#first;
  }

  /** Drops the snapshots taken after frame `frameId`, except the first one. */
  dropAfter(frameId: number): void {
    this.#later.splice(this.#later.findLastIndex((s) => s.frameId <= frameId) + 1);
  }
}
