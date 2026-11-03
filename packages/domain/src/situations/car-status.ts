// The car-status sub-machine's span declaration (contract C15, C17): car-scoped, whether a car still competes. Shared.
import { defineSpans } from '../facts.ts';
import type { Known } from '../known.ts';

/** The detail of a `retired` span: why the car retired, once known. */
export type RetiredDetail = { cause: Known<'mechanical' | 'terminalDamage' | 'other'> };

/** A car's status (`spans:car-status`); only `retired` has a detail. A car is in the session while its status is not `absent`. */
export const spans = defineSpans({ machine: 'car-status', scope: 'car', kinds: ['competing', 'retired', 'disqualified', 'absent'] });
