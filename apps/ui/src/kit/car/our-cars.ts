import type { SessionInfo } from '@pitwall/contracts';
import type { CarId } from '@pitwall/domain';

/** Our cars from `session.info`: the player, then the teammate when there is one (the ordered set `carColour` expects); none without a session. */
export function ourCars(session: Pick<SessionInfo, 'playerCar' | 'teammateCar'> | undefined): ReadonlySet<CarId> {
  if (session === undefined) return new Set();
  return new Set(session.teammateCar === undefined ? [session.playerCar] : [session.playerCar, session.teammateCar]);
}
