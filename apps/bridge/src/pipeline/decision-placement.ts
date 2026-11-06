// Where a committed decision lands (C76, C38; ruling R28): the frame a decision fact describes follows from the record
// index it is placed at, so this module is part of the rules version (C61, C90). It imports nothing, so it is the only
// bridge file the rules-version walk reaches, and it carries out the whole rule; the pipeline and the session processor
// only call it. The rule, live and replay alike: the session's records are the datagrams of its own uid or of uid 0
// (`SessionRecords.keep`); a decision committed once `i` of them are kept has record index `i` (`SessionRecords.place`);
// and a decision of record index `i` is handed to the session before record `i` is decoded, pushed and recorded
// (`RecordedPlacement.deliver`), so the session's next frame carries it to the runner.

/** A decision with the record index it is handed to the session before (the decisions sidecar's entry). */
export type Placed<D> = { recordIndex: number; decision: D };

/** Live: which records count toward a decision's record index, and where a decision committed now is placed. */
export class SessionRecords {
  readonly #sessionUid: bigint;
  #count = 0;

  constructor(sessionUid: bigint) {
    this.#sessionUid = sessionUid;
  }

  /** Keeps a record that belongs to the session (its own uid, or uid 0): `write` runs and the count grows by one. */
  keep(recordUid: bigint | undefined, write: () => void): void {
    if (recordUid !== this.#sessionUid && recordUid !== 0n) return;
    write();
    this.#count++;
  }

  /** The number of records the session has kept. */
  get count(): number {
    return this.#count;
  }

  /** A decision committed now goes before the next record the session keeps. */
  place<D>(decision: D): Placed<D> {
    return { recordIndex: this.#count, decision };
  }
}

/** A replay: the recorded decisions by the record index they go before, handed out one record at a time. */
export class RecordedPlacement<D> {
  readonly #at = new Map<number, D[]>();
  /** The index of the next record the source delivers. */
  #next = 0;

  constructor(placed: readonly Placed<D>[]) {
    for (const { recordIndex, decision } of placed) this.#at.set(recordIndex, [...(this.#at.get(recordIndex) ?? []), decision]);
  }

  /**
   * Delivers the next record: first `decide` for each decision placed at its index, in recorded order, then
   * `process(record)` (decode, push, record); then moves on to the record after it.
   */
  deliver<R>(record: R, steps: { decide: (decision: D) => void; process: (record: R) => void }): void {
    for (const decision of this.#at.get(this.#next) ?? []) steps.decide(decision);
    this.#next++;
    steps.process(record);
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
