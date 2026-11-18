// The rebuild service's interface (C61, SP4.3e spec §4.3 item 3a; Task 0c, built in a later task): it brings stored
// sessions to the current rules version before they are used, one session at a time, off the thread that applies
// frames, by priority; the planning round's replay (C62d) runs in the same worker and queue.
import type { SessionKey } from './db.ts';

/** Who waits, highest first: a confirmed basis of a running session, a planning replay, any other first read. */
export type RebuildPriority = 'runningBasis' | 'planning' | 'firstRead';

/**
 * A planning round's replay (C62d): the qualifying's recording replayed to its end with `basisOverride` as its basis in
 * place of the recording's basis sidecar and its `basisChosen` decisions, and the race assumptions (`laps`, `sets`).
 */
export type ReplayJob = { pwrecPath: string; basisOverride: SessionKey[]; laps: number; sets: 'carried' | 'fresh' };

export type RebuildService = {
  /**
   * Resolves once every session of `refs` is current (C61): a stale one is rebuilt from its recording, a current one
   * waits for nothing. `onProgress` is told the sessions done of the total; `priority` defaults to `firstRead`.
   */
  ensureCurrent(refs: readonly SessionKey[], opts?: { priority?: RebuildPriority; onProgress?: (done: number, total: number) => void }): Promise<void>;
  /** The planning replay, in the same worker and queue as the rebuilds. */
  replayToEnd<T>(job: ReplayJob, priority: RebuildPriority): Promise<T>;
  /** Finishes the session being rebuilt, drops the queue and stops the worker. */
  close(): Promise<void>;
};
