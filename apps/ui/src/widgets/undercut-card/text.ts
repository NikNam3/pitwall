// STUB (test phase, SP4.3b2 Task 13): the shape the tests assume of the undercut card's wording (mockup gen.mjs
// `TEXT.undercut`); every value throws `not implemented` until the implement phase writes it. No sentence in the panel;
// hovers may be phrases.
import type { Ms } from '@pitwall/domain';

/** A stand-in that throws `not implemented` when read (so each test fails on its own, not at import). */
const notImplemented = <T>(): T => {
  const fail = (): never => {
    throw new Error('not implemented');
  };
  return new Proxy(fail, { get: fail, apply: fail, has: fail }) as T;
};

/** Full-size column headers: `POS`, `GAP`, `N`, `ΔGAP`, `P(AH)`, `REJ` (the car and strip columns have none). */
export const headers: { pos: string; gap: string; n: string; dGap: string; pAhead: string; rej: string } = notImplemented();
/** Compact column headers per N: `N1`, `N2`, `N3`. */
export const nHeader: Record<1 | 2 | 3, string> = notImplemented();
/** Our line's hover when no rival is in range: the range searched (`no car within 3.0 s`). */
export const noneHover: (rangeMs: Ms) => string = notImplemented();
