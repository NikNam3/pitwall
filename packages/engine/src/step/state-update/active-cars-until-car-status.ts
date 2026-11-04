// Transitional (Task 4 review F1 ruling, Task 10 plan-gap ruling): `car.active` is read by analyses, the bridge and the
// UI until Task 24 moves them to car-status (analyses read situations from Task 18 on). Until then it is refreshed after
// every step-1 module, from the identity and timing modules' same-frame output, by car-status's rule
// (`situations/car-status/slots.ts`), the one rule of which cars are in the session (C43). Nothing else follows the
// modules: placing the player is the identity module's own output, realism each module's own (C8, C11).
import type { LiveState } from '../../state/live-state.ts';
import { isActiveCar, slotsInUse } from '../../situations/car-status/slots.ts';
import type { StepOutput } from '../types.ts';

/** Refreshes `car.active` when identity or timing changed (transitional until Task 24, by car-status's rule). */
export const refreshActiveCarsUntilCarStatus = (live: LiveState, out: StepOutput): void => {
  if (!out.changed.has('identity') && !out.changed.has('timing')) return;
  const slots = slotsInUse(live);
  for (const car of live.cars) car.active = isActiveCar(car.id, slots, car.timing.resultStatus);
};
