// The ghost marker's one look (SP4.2 spec §5, B1): every view of the rejoin ghost (the crossing order's row, the gap
// chart's lines, the track map's ring) draws it in one faint role, its line dashed by condition (C68).
import type { PitCondition } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';

/** A ghost line's dash per condition, in px (the canvas' `setLineDash`). */
export const GHOST_DASH: Readonly<Record<PitCondition, readonly number[]>> = {
  green: [2, 3],
  vsc: [7, 3],
  sc: [7, 3, 2, 3],
};

/** The one role every ghost is drawn in. */
export const GHOST_ROLE = 'textFaint' as const satisfies Role;
