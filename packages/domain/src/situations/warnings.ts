// The warnings sub-machine's span declaration (contract C15, C17): car-scoped, the warnings a car holds. Shared.
import { defineSpans } from '../facts.ts';

/** The detail of a `warned` span: the car's warning count it holds, and the infringement of the warning that raised it. */
export type WarnedDetail = { count: number; infringement: number };

/** A car's warnings (`spans:warnings`): `noWarning` until the first, then one `warned` span per count. */
export const spans = defineSpans({ machine: 'warnings', scope: 'car', kinds: ['noWarning', 'warned'] });
