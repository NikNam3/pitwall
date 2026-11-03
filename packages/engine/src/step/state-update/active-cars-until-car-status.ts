// Transitional (Task 4 review F1 ruling): which cars are active is read after every step-1 module, from the identity
// and timing modules' same-frame output, until Task 10 moves it into the car-status sub-machine. Nothing else follows
// the modules: placing the player is the identity module's own output, realism each module's own (C8, C11).
import type { LiveState } from '../../state/live-state.ts';
import { isActiveCar, slotsInUse } from '../active-cars.ts';
import type { StepOutput } from '../types.ts';

/** Refreshes `car.active` when identity or timing changed (transitional until Task 10, car-status). */
export const refreshActiveCarsUntilCarStatus = (live: LiveState, out: StepOutput): void => {
  if (!out.changed.has('identity') && !out.changed.has('timing')) return;
  const slots = slotsInUse(live);
  for (const car of live.cars) car.active = isActiveCar(car.id, slots, car.timing.resultStatus);
};
