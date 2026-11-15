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

/** A pass chance at a braking zone from which a pass is likely: about the curve's chance at 1 s a lap faster with DRS. */
const LIKELY_PASS = 0.25;

/** The pass chance's role: a likely pass ahead (ours) is white, behind (theirs on us) a warning; anything else is plain. */
export function passChanceRole(side: Side, chance: Known<number> | undefined): Role | undefined {
  if (chance === undefined || !chance.known || chance.value < LIKELY_PASS) return undefined;
  return side === 'ahead' ? 'text' : 'warning';
}
