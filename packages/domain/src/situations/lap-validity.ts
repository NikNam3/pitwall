// The lap-validity sub-machine's span declaration (contract C15, C17): car-scoped, whether a car's current lap counts. Shared.
import { defineSpans } from '../facts.ts';

/** The detail of an `invalid` span: the infringement that invalidated the lap, and which laps it invalidates. */
export type InvalidLapDetail = { reason: number; scope: 'this' | 'thisAndNext' | 'thisAndPrevious' };

/** A car's lap validity (`spans:lap-validity`); only `invalid` has a detail. */
export const spans = defineSpans({ machine: 'lap-validity', scope: 'car', kinds: ['valid', 'invalid'] });
