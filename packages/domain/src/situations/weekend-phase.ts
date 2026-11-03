// The weekend-phase sub-machine's span declaration (contract C14, C15): session-scoped, one span per session once the
// phase is decided; its kind is the phase, its detail the format (and the segment of a multi-part session).
import { defineSpans } from '../facts.ts';
import type { PracticeFormat, QualifyingFormat, RaceFormat } from '../weekend-phase.ts';

/** The detail of a `practice` span. */
export type PracticePhaseDetail = { format: PracticeFormat; segment: 1 | 2 | 3 | undefined };
/** The detail of a `qualifying` span (a sprint shootout is qualifying with its format). */
export type QualifyingPhaseDetail = { format: QualifyingFormat; segment: 1 | 2 | 3 | undefined };
/** The detail of a `race` span (a sprint is the race with format `sprint`). */
export type RacePhaseDetail = { format: RaceFormat };

/** The weekend phase's spans (`spans:weekend-phase`): session-scoped; `none` for a time trial or an unknown session type. */
export const spans = defineSpans({ machine: 'weekend-phase', scope: 'session', kinds: ['practice', 'qualifying', 'race', 'none'] });
