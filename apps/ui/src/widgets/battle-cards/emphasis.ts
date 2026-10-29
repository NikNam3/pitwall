import type { CarId, Known, RaceMoment } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Which side of a card. */
export type Side = 'ahead' | 'behind';

/** `text` (white bold) for the card's side the battle moment names; nothing in other moments or for other cars. */
export function battleRole(moment: Known<RaceMoment> | undefined, car: CarId, side: Side): Role | undefined {
  if (moment === undefined || !moment.known || moment.value.moment !== 'battle') return undefined;
  const { params } = moment.value.cause;
  return params.carId === car && params.side === side ? 'text' : undefined;
}
