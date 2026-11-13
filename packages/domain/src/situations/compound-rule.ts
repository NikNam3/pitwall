// The compound-rule sub-machine's span declaration (contract C15, C17): car-scoped, race only, whether the car must still
// run a second dry compound.
import { defineSpans } from '../facts.ts';

/** A car's compound rule (`spans:compound-rule`): `required` while the rule applies (whether a car has met it is an analysis judgement: `shared/compound-rule.ts`, C43), `waived` otherwise; no detail. */
export const spans = defineSpans({ machine: 'compound-rule', scope: 'car', kinds: ['required', 'waived'] });
