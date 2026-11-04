// The incident feed's presentation table (contract C66): every moment of `raceMoment.current` to the emphasis of the
// major entry the moment's cause names (`entryId`). Only the incident moment lights it, amber. Minor entries stay dim in
// every moment (`emphasis.ts`).
import type { Moment } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import type { Role } from '../../theme/roles.ts';

/** A moment's row: the role of the major entry its cause names; `undefined` lights nothing. */
export type MomentRow = { readonly emphasis: Role | undefined };

export const presentation = {
  moments: {
    neutralised: { emphasis: undefined },
    incident: { emphasis: 'warning' },
    weather: { emphasis: undefined },
    battle: { emphasis: undefined },
    carCare: { emphasis: undefined },
  },
} as const satisfies PresentationTable & { moments: Readonly<Record<Moment, MomentRow>> };
