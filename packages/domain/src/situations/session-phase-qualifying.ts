// The qualifying session-phase sub-machine's span declaration (contract C14, C15, C17): session-scoped, the phases of a
// qualifying session from the grid to the post-session. A `suspended` span's detail is `SuspendedDetail`
// (`session-phase-race.ts`); the other kinds have no detail.
import { defineSpans } from '../facts.ts';

/** The qualifying session phases (`spans:session-phase-qualifying`). */
export const spans = defineSpans({
  machine: 'session-phase-qualifying',
  scope: 'session',
  kinds: ['grid', 'running', 'suspended', 'finished', 'postSession'],
});
