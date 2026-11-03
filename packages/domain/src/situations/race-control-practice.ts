// The practice race-control sub-machine's span declaration (contract C15, C17): session-scoped; DRS is free to use all session.
import { defineSpans } from '../facts.ts';

/** Race control in practice (`spans:race-control-practice`); no detail. */
export const spans = defineSpans({ machine: 'race-control-practice', scope: 'session', kinds: ['drsFree'] });
