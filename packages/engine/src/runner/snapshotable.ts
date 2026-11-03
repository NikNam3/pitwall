// Protocol-free (C6): the scheduler implements it without reaching the runner's frames.

/** State a runner can save with each snapshot and put back on a rewind (C27): the bookkeeping of what reads its results. */
export type Snapshotable<S> = { snapshot(): S; restore(s: S): void };
