// The car-location sub-machine's span declaration (contract C15, C17): car-scoped, where a car physically is. Shared.
import { defineSpans } from '../facts.ts';

/** A car's location (`spans:car-location`); no kind has a detail. */
export const spans = defineSpans({ machine: 'car-location', scope: 'car', kinds: ['garage', 'pitLane', 'track'] });
