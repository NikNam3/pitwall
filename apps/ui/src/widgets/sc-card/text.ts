// Wording of the sc-card display; text shared with the kit lives in kit/text.ts.
import type { ScCallRow } from '@pitwall/domain';

/** Headers of the full sheet by column key (the COND column has none). */
export const headers = { rejoin: 'REJOIN', loss: 'LOSS', gain: 'GAIN' } as const;
/** A condition's name. */
export const conditions = { sc: 'SC', vsc: 'VSC' } as const satisfies Record<ScCallRow['condition'], string>;
