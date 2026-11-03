import type { CarState } from '@pitwall/domain';
import { isActiveCar, slotsInUse } from '../step/active-cars.ts';
import type { RecorderInput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** A car of the live state as a recorder reads it. */
export type LiveCar = DeepReadonly<CarState>;

/**
 * The cars in the session that have LapData in this frame: step 1 stamped their timing at the frame's time (C10: a
 * recorder reads the live state, not the frame).
 */
export const carsWithLapData = (input: DeepReadonly<RecorderInput>): LiveCar[] => {
  const { live, at } = input;
  const slots = slotsInUse(live);
  return live.cars.filter((car) => car.updatedAt.lapData === at && isActiveCar(car.id, slots, car.timing.resultStatus));
};
