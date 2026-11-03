// The compound-rule sub-machine's span declaration (contract C15, C17): car-scoped, race only, whether the car must still
// run a second dry compound.
import { defineSpans } from '../facts.ts';

/** A car's compound rule (`spans:compound-rule`): `required` until it is met or waived; no detail. */
export const spans = defineSpans({ machine: 'compound-rule', scope: 'car', kinds: ['required', 'waived'] });
