// The zone-flags sub-machine's span declaration (contract C15, C17): zone-scoped, the flag of one marshal zone. Shared.
import { defineSpans } from '../facts.ts';
import type { Ratio } from '../units.ts';

/** The detail of every zone-flags span: where its marshal zone (`Span.zone`) starts on the lap. */
export type ZoneFlagDetail = { startFraction: Ratio };

/**
 * A marshal zone's flag (`spans:zone-flags`), every kind with `ZoneFlagDetail`. `noFlag` is the game's "none"; `unknown`
 * its "invalid/unknown" (C3).
 */
export const spans = defineSpans({ machine: 'zone-flags', scope: 'zone', kinds: ['noFlag', 'green', 'blue', 'yellow', 'unknown'] });
