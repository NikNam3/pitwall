// Wording of the Box call (sc-card); text shared with the kit lives in kit/text.ts.
import type { ScCallAnswer, ScCallBlock } from '@pitwall/domain';

/** The panel's title. */
export const title = 'Box call';
/** Headers of the full sheet by column key (the label column carries the condition). */
export const headers = { ePos: 'E[POS]', dPos: 'ΔPOS', pGain: 'P(GAIN)', rejoin: 'REJ' } as const;
/** A condition's name. */
export const conditions = { sc: 'SC', vsc: 'VSC', green: 'GREEN' } as const satisfies Record<ScCallBlock['condition'], string>;
/** An answer's label. */
export const answers = {
  stay: 'stay',
  S: 'box S',
  M: 'box M',
  H: 'box H',
  I: 'box I',
  W: 'box W',
} as const satisfies Record<ScCallAnswer, string>;
/** The E[POS] cell of an answer without a set of its compound left. */
export const noSet = 'no set';
