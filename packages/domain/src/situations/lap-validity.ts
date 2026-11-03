// The lap-validity sub-machine's span declaration (contract C15, C17): car-scoped, whether a car's current lap counts. Shared.
import { defineSpans } from '../facts.ts';
import type { Known } from '../known.ts';

/**
 * The detail of an `invalid` span: the infringement of the PENA that invalidated the lap, and which laps its penalty type
 * invalidates; each unknown when no PENA explains the flag (C3).
 */
export type InvalidLapDetail = { reason: Known<number>; scope: Known<'this' | 'thisAndNext' | 'thisAndPrevious'> };

/** A car's lap validity (`spans:lap-validity`); only `invalid` has a detail. */
export const spans = defineSpans({ machine: 'lap-validity', scope: 'car', kinds: ['valid', 'invalid'] });
