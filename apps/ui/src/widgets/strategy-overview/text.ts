// Wording of the Field plans display (mockup docs/design/2026-11-16-sp4.3d/strategy-overview.html, gen.mjs
// `TEXT.overview`); text shared with the kit lives in kit/text.ts. No sentence in the panel; hovers may be phrases.
import { separator } from '../../kit/text.ts';

/** Column headers: full `POS`, `GAP`, `TYRE`, `NEXT` (the car and owe columns have none); compact adds `WINDOW`. */
export const headers = { pos: 'POS', gap: 'GAP', tyre: 'TYRE', next: 'NEXT', window: 'WINDOW' };
/** The mark of a car that still owes its second dry compound, and its hover. */
export const oweMark = '²';
export const oweHover = 'still owes its second dry compound';
/** Our compact WINDOW cell: plan A's next stop, `A L22`. */
export const planAStop = (lap: string): string => `A ${lap}`;
/** NEXT's hover: every odd, then the window and its likeliest lap (`H 80% · S 20% · window L16–L20, likeliest L18`). */
export const nextHover = (odds: readonly string[], low: string, high: string, mid: string): string =>
  [...odds, `window ${low}–${high}, likeliest ${mid}`].join(separator);
/** One odd of NEXT's hover, `H 80%`. */
export const odd = (letter: string, share: string): string => `${letter} ${share}`;
