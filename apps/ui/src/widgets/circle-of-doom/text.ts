// Wording of the circle-of-doom display; text shared with the kit lives in kit/text.ts.
import type { PitCondition } from '@pitwall/domain';

/** A ghost's letter by its condition. */
export const ghostLetters = { green: 'G', vsc: 'V', sc: 'S' } as const satisfies Record<PitCondition, string>;
/** The gaps line's arrows: to the car ahead and to the car behind. */
export const arrows = { ahead: '↑', behind: '↓' } as const;
