// Where a committed decision lands (C76, C38; ruling R28): the frame a decision fact describes follows from the record
// index it is placed at, so this module is part of the rules version (C61, C90). It imports nothing, so it is the only
// bridge file the rules-version walk reaches. The rule, live and replay alike: a decision committed at record index `i`
// (once `i` records are in the session file) is handed to the session before record `i` is pushed, and the session's
// next frame carries it to the runner.

/** A decision with the record index it is handed to the session before (the decisions sidecar's entry). */
export type Placed<D> = { recordIndex: number; decision: D };

/** Live: a decision committed once `recordsWritten` records are in the session file goes before record `recordsWritten`. */
export function placeCommitted<D>(decision: D, recordsWritten: number): Placed<D> {
  return { recordIndex: recordsWritten, decision };
}

/** A replay: the recorded decisions by the record index they go before, handed out one record at a time. */
export class RecordedPlacement<D> {
  readonly #at = new Map<number, D[]>();
  /** The index of the next record the source delivers. */
  #next = 0;

  constructor(placed: readonly Placed<D>[]) {
    for (const { recordIndex, decision } of placed) this.#at.set(recordIndex, [...(this.#at.get(recordIndex) ?? []), decision]);
  }

  /** The decisions to hand to the session before the next record, in their recorded order; then moves to the record after it. */
  beforeNextRecord(): readonly D[] {
    return this.#at.get(this.#next++) ?? [];
  }
}

/** The decisions handed to a session since its last frame: its next frame carries them to the runner (C10, C76). */
export class PendingDecisions<D> {
  #pending: D[] = [];

  add(decision: D): void {
    this.#pending.push(decision);
  }

  /** The pending decisions, in the order they were handed over, newest last. */
  get list(): readonly D[] {
    return this.#pending;
  }

  /** The decisions the next frame carries; none are pending afterwards. */
  takeForFrame(): D[] {
    return this.#pending.splice(0);
  }
}
