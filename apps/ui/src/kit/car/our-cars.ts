import type { SessionInfo } from '@pitwall/contracts';
import { ourCars as domainOurCars, type CarId } from '@pitwall/domain';

/** Our cars from `session.info` (the domain's `ourCars`): the player, then the teammate when it is a different car (the ordered set `carColour` expects); none without a session. */
export function ourCars(session: Pick<SessionInfo, 'playerCar' | 'teammateCar'> | undefined): ReadonlySet<CarId> {
  return session === undefined ? new Set() : new Set(domainOurCars(session));
}
