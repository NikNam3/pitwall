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
