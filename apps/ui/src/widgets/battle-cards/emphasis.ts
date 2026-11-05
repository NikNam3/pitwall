import type { CarId, Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { presentation } from './presentation.ts';

/** Which side of a card. */
export type Side = 'ahead' | 'behind';

/** The current moment's row emphasis (`presentation.ts`) for the card's side its cause names; nothing for other cars or sides. */
export function battleRole(moment: Known<RaceMoment> | undefined, car: CarId, side: Side): Role | undefined {
  if (moment === undefined || !moment.known) return undefined;
  const { params } = moment.value.cause;
  return params.carId === car && params.side === side ? presentation.moments[moment.value.moment].emphasis : undefined;
}

/** The margin's role: a positive pass is white, a negative hold is a warning; anything else is plain. */
export function marginRole(margin: Known<{ kind: 'pass' | 'hold'; ms: number }> | undefined): Role | undefined {
  if (margin === undefined || !margin.known) return undefined;
  const { kind, ms } = margin.value;
  if (kind === 'pass') return ms > 0 ? 'text' : undefined;
  return ms < 0 ? 'warning' : undefined;
}
