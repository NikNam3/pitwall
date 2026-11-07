// Wording of the crossing-order display; text shared with the kit lives in kit/text.ts. No sentence (K6).
import type { PitCondition } from '@pitwall/domain';

/** A track condition's name: a block's title. */
export const conditions = { green: 'green', vsc: 'VSC', sc: 'SC' } as const satisfies Record<PitCondition, string>;
/** Headers of a block's order by column key. */
export const headers = { p: 'P', drv: 'DRV', int: 'INT' } as const;
