// The warnings sub-machine's span declaration (contract C15, C17): car-scoped, the warnings a car holds. Shared.
import { defineSpans } from '../facts.ts';
import type { Known } from '../known.ts';

/**
 * The detail of a `warned` span: the car's warning count it holds, and the infringement of the PENA that raised it
 * (unknown when no PENA explains the count, e.g. a car the engine joined already warned, C3).
 */
export type WarnedDetail = {
  count: number;
  /** The game's `cornerCuttingWarnings` of the car: how many of `count` are corner-cutting warnings. */
  cornerCutting: number;
  infringement: Known<number>;
};

/** A car's warnings (`spans:warnings`): `noWarning` until the first, then one `warned` span per count. */
export const spans = defineSpans({ machine: 'warnings', scope: 'car', kinds: ['noWarning', 'warned'] });
