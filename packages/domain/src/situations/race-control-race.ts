// The race's race-control sub-machine's span declaration (contract C15, C17): session-scoped, what race control allows
// the field in a race; today DRS.
import { defineSpans } from '../facts.ts';

/** Why DRS is off: DRSD's reasons, `notEnabledYet` before DRSE first enables it, `unknown` for a reason code the spec does not list (C3). */
export type DrsOffReason = 'notEnabledYet' | 'wetTrack' | 'safetyCar' | 'redFlag' | 'minLapNotReached' | 'unknown';
/** The detail of a `drsOff` span. */
export type DrsOffDetail = { reason: DrsOffReason };

/** Race control in a race (`spans:race-control-race`); only `drsOff` has a detail. */
export const spans = defineSpans({ machine: 'race-control-race', scope: 'session', kinds: ['drsOff', 'drsOn'] });
