// The penalties sub-machine's span declaration (contract C15, C17): car-scoped, race only, what a car owes race control
// now: nothing, a time penalty that stands, or a drive-through or stop-go to serve. One span per car at a time (C85).
import { defineSpans } from '../facts.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/** The detail of a `timePenalty` span: the car's time penalties in total, and the infringement of the PENA that raised it (unknown without one, C3). */
export type TimePenaltyDetail = { totalMs: Ms; infringement: Known<number> };

/**
 * The detail of a `driveThroughPending` or `stopGoPending` span: the unserved drive-throughs and stop-gos, the
 * infringement of the PENA that gave the penalty the span's kind names (unknown when no PENA explains it, C3), and the
 * time penalties in total that stand beside them.
 */
export type PendingPenaltyDetail = { driveThroughs: number; stopGos: number; infringement: Known<number>; totalMs: Ms };

/**
 * A car's penalties (`spans:penalties`): `clear` while it owes nothing; `timePenalty` while only time penalties stand;
 * `driveThroughPending` / `stopGoPending` while a penalty is to be served, named after the oldest unserved one. A new
 * span on every change of what the car owes.
 */
export const spans = defineSpans({ machine: 'penalties', scope: 'car', kinds: ['clear', 'timePenalty', 'driveThroughPending', 'stopGoPending'] });
