// Step 1's last part (contract C8, C11): what follows from the modules' writes, read after all of them, so no module
// reads another's same-frame output and the modules run in any order.
import type { Frame } from '../../frame/frame.ts';
import type { LiveState } from '../../state/live-state.ts';
import { isActiveCar, slotsInUse } from '../active-cars.ts';
import type { StepOutput } from '../types.ts';
import { placePlayer } from './identity.ts';
import { applyRealism } from './realism.ts';

/**
 * Places the player when identity changed (visibility, own data, the teammate), refreshes which cars are active when
 * identity or timing changed, and masks the rivals in realism mode (C8).
 */
export const settleLiveState = (live: LiveState, frame: Frame, out: StepOutput): void => {
  if (out.changed.has('identity')) placePlayer(live, frame.playerCarIndex);
  if (out.changed.has('identity') || out.changed.has('timing')) {
    const slots = slotsInUse(live);
    for (const car of live.cars) car.active = isActiveCar(car.id, slots, car.timing.resultStatus);
  }
  applyRealism(live);
};
