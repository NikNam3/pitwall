import type { CarId } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Our cars (player and teammate) are the white `ownCar` line; every other car keeps its team colour. */
export function lineRole(carId: CarId, ours: ReadonlySet<CarId>): Role | undefined {
  return ours.has(carId) ? 'ownCar' : undefined;
}
