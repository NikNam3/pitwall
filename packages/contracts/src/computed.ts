/**
 * The value of a job's topic: what the job computed and what it was computed for, the player's lap and the frame
 * that triggered it. Results arrive asynchronously, so `computedFor` tells how old a value is.
 */
export type Computed<T> = { computedFor: { lap: number; frameId: number }; value: T };
