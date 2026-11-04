// Which slots hold a car of the session (contract C43): the one rule, car-status's. car-status opens `absent` for a slot
// it gives false; step 1's identity module places the teammate by it too. It reads the signals as step 1 wrote them
// (`Signals`: each car's `resultStatus`, the session's `numActiveCars`), never the live state (C13).
import { OUT_OF_RACE_STATUSES, type ResultStatus } from '@pitwall/domain';
import type { CarSignals, SessionSignals } from '../../signals/types.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';

/** What the rule reads: the cars' result status and the session's `numActiveCars`. */
type Slots = DeepReadonly<{ cars: Array<Pick<CarSignals, 'resultStatus'>>; session: Pick<SessionSignals, 'numActiveCars'> }>;

/**
 * The slots the session uses. Participants `numActiveCars` counts only the cars still in the race, and a car that drops
 * out keeps its slot (the game does not renumber), so each car out of the race (`OUT_OF_RACE_STATUSES`) adds one slot
 * to the count.
 */
export const slotsInUse = (signals: Slots): number =>
  signals.cars.reduce((slots, car) => (OUT_OF_RACE_STATUSES.has(car.resultStatus) ? slots + 1 : slots), signals.session.numActiveCars);

/** Whether the car is in the session: a slot below `slots` (see `slotsInUse`) that the game has not marked invalid or inactive. */
export const isActiveCar = (index: number, slots: number, resultStatus: ResultStatus): boolean =>
  index < slots && resultStatus !== 'invalid' && resultStatus !== 'inactive';
