import type { CarId } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** A gap-chart line's look: our car in the ownCar role (the teammate dashed), every other car textFaint. */
export interface LineLook {
  role: Role;
  dashed: boolean;
  ownCar: boolean;
}

/** The look of one car's line; `player` is the first of our cars, the others are teammates. */
export function lineLook(own: boolean, car: CarId, player: CarId | undefined): LineLook {
  return own ? { role: 'ownCar', dashed: car !== player, ownCar: true } : { role: 'textFaint', dashed: false, ownCar: false };
}
