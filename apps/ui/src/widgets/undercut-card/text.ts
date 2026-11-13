// Wording of the undercut-card display (mockup docs/design/2026-11-12-sp4.3b/undercut-card.html, gen.mjs
// `TEXT.undercut`); text shared with the kit lives in kit/text.ts. No sentence in the panel; hovers may be phrases.
import type { Ms } from '@pitwall/domain';
import { formatSecondsUnit } from '../../kit/values/format.ts';

/** Full-size column headers: `POS`, `GAP`, `N`, `ΔGAP`, `P(AH)`, `REJ` (the car and strip columns have none). */
export const headers = { pos: 'POS', gap: 'GAP', n: 'N', dGap: 'ΔGAP', pAhead: 'P(AH)', rej: 'REJ' };
/** Compact column headers per N: `N1`, `N2`, `N3`. */
export const nHeader: Record<1 | 2 | 3, string> = { 1: 'N1', 2: 'N2', 3: 'N3' };
/** Our line's hover when no rival is in range: the range searched (`no car within 3.0 s`). */
export const noneHover = (rangeMs: Ms): string => `no car within ${formatSecondsUnit(rangeMs, 1)}`;
