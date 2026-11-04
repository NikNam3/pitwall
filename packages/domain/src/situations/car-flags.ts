// The car-flags sub-machine's span declaration (contract C15, C17): car-scoped, the flag race control shows a car. Shared.
import { defineSpans } from '../facts.ts';

/**
 * A car's flag (`spans:car-flags`); no kind has a detail. `noFlag` is the game's "none"; `unknown` its "invalid/unknown"
 * (missing data is never a value, C3).
 */
export const spans = defineSpans({ machine: 'car-flags', scope: 'car', kinds: ['noFlag', 'green', 'blue', 'yellow', 'unknown'] });
