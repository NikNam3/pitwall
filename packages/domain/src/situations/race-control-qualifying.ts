// The qualifying race-control sub-machine's span declaration (contract C15, C17): session-scoped; DRS is free to use all session.
import { defineSpans } from '../facts.ts';

/** Race control in qualifying (`spans:race-control-qualifying`); no detail. */
export const spans = defineSpans({ machine: 'race-control-qualifying', scope: 'session', kinds: ['drsFree'] });
