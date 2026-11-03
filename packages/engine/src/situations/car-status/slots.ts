// Which slots hold a car of the session (contract C43): the one rule, car-status's. car-status opens `absent` for a slot
// it gives false. Transitional until Task 24: step 1's `car.active` (`refreshActiveCarsUntilCarStatus`) and the identity
// module's teammate import it from here. Protocol-free and signal-free (C6, C13): it reads plain result statuses and the
// slot count, whoever holds them.
import { OUT_OF_RACE_STATUSES, type CarTiming, type ResultStatus, type SessionState } from '@pitwall/domain';
import type { DeepReadonly } from '../../util/deep-readonly.ts';

/** What the rule reads: the cars' result status and the session's `numActiveCars`. */
type Slots = DeepReadonly<{ cars: Array<{ timing: Pick<CarTiming, 'resultStatus'> }>; session: Pick<SessionState, 'numActiveCars'> }>;

/**
 * The slots the session uses. Participants `numActiveCars` counts only the cars still in the race, and a car that drops
 * out keeps its slot (the game does not renumber), so each car out of the race (`OUT_OF_RACE_STATUSES`) adds one slot
 * to the count.
 */
export const slotsInUse = (state: Slots): number =>
  state.cars.reduce((slots, car) => (OUT_OF_RACE_STATUSES.has(car.timing.resultStatus) ? slots + 1 : slots), state.session.numActiveCars);

/** Whether the car is in the session: a slot below `slots` (see `slotsInUse`) that the game has not marked invalid or inactive. */
export const isActiveCar = (index: number, slots: number, resultStatus: ResultStatus): boolean =>
  index < slots && resultStatus !== 'invalid' && resultStatus !== 'inactive';
