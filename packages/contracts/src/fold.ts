/**
 * How an append topic's entries combine on the client: `init` makes the empty
 * accumulator, `add` folds a batch of new entries into it.
 */
export type Fold<E, R> = { init: () => R; add: (acc: R, entries: readonly E[]) => R };
