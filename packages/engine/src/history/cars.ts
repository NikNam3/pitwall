import type { CarState } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import type { EngineState } from '../state/engine-state.ts';
import { isActiveCar } from '../step/identity.ts';

/**
 * The cars in the session that have LapData in this frame. Activity is worked out here, not read from `car.active`,
 * which `step` refreshes only after all sub-steps and is therefore one frame behind.
 */
export const carsWithLapData = (state: EngineState, frame: Frame): CarState[] => {
  const { lapData } = frame;
  if (!lapData) return [];
  return state.cars.filter(
    (car) => lapData.lapData[car.id] !== undefined && isActiveCar(car.id, state.session.numActiveCars, car.timing.resultStatus),
  );
};
