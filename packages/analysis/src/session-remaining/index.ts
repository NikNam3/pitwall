// `session-remaining` (spec 4): a shared calculator without topics; others read it through `{ calculator: SESSION_REMAINING }`.
import type { Known, Ms } from '@pitwall/domain';

/** The calculator id. */
export const SESSION_REMAINING = 'session-remaining';

/**
 * The output: laps left as a fraction in a race (`totalLaps` minus the leader's completed laps and lap fraction), or
 * the time left in a timed session; `basis` says which one the session runs on.
 */
export type SessionRemaining = { basis: 'laps' | 'time'; lapsLeft: Known<number>; timeLeftMs: Known<Ms> };
