// Wording of the sc-card display; text shared with the kit lives in kit/text.ts.
import type { ScCallRow } from '@pitwall/domain';

/** Headers of the full sheet by column key (the COND column has none). */
export const headers = { dPos: 'ΔPOS', pGain: 'P(GAIN)', rejoin: 'REJ', loss: 'LOSS', range: 'RANGE' } as const;
/** The strip's labels: places gained at its first bin, its zero bin and its last bin. */
export const stripLabels = { low: '−4', zero: '0', high: '+4' } as const;
/** A condition's name. */
export const conditions = { sc: 'SC', vsc: 'VSC' } as const satisfies Record<ScCallRow['condition'], string>;
