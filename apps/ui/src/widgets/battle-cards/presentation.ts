// The battle cards' presentation table (contract C66): every moment of `raceMoment.current` to the emphasis of the card's
// side the moment's cause names. Only the battle moment lights it, white bold.
import type { Moment } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import type { Role } from '../../theme/roles.ts';

/** A moment's row: the role of the side its cause names (`carId`, `side`); `undefined` lights nothing. */
export type MomentRow = { readonly emphasis: Role | undefined };

export const presentation = {
  moments: {
    neutralised: { emphasis: undefined },
    incident: { emphasis: undefined },
    window: { emphasis: undefined },
    weather: { emphasis: undefined },
    battle: { emphasis: 'text' },
    carCare: { emphasis: undefined },
  },
} as const satisfies PresentationTable & { moments: Readonly<Record<Moment, MomentRow>> };
