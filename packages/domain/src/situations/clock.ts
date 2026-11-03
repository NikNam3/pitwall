// The clock's span declaration (contract C7, C15, C36): step 0's clock is session-scoped, its one span kind `paused`.
import { defineSpans } from '../facts.ts';

/** The detail of the clock's one span kind, `paused`: what paused the session and how long it lasted in wall time. */
export type PausedDetail = { source: 'offline' | 'online'; wallMs: number };

/** The clock's spans (`spans:clock`): session-scoped, the kind `paused`. */
export const spans = defineSpans({ machine: 'clock', scope: 'session', kinds: ['paused'] });
