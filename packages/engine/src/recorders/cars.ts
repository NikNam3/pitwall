import type { CarState } from '@pitwall/domain';
import { CAR_STATUS, carsInSessionOf } from '../situations/car-status/in-session.ts';
import type { RecorderInput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** A car of the live state as a recorder reads it. */
export type LiveCar = DeepReadonly<CarState>;

type Input = DeepReadonly<RecorderInput>;

/**
 * The lists below by the frame's recorder input: every recorder of a frame gets the same input (C10), and a list is a
 * pure function of it, so it is worked out once per frame whichever recorder asks first (C11: the order changes nothing).
 */
const inSessionBy = new WeakMap<Input, readonly LiveCar[]>();
const withLapDataBy = new WeakMap<Input, readonly LiveCar[]>();

/**
 * The cars in the session: those whose car-status span is not `absent`, read from the frame's situation (C10, C20), as
 * `step` worked them out once for the frame (`input.carsInSession`); car-status is the one decider (C43).
 */
export const carsInSession = (input: Input): readonly LiveCar[] => {
  let cars = inSessionBy.get(input);
  if (cars === undefined) {
    cars = (input.carsInSession ?? carsInSessionOf(input.situation.byMachine[CAR_STATUS])).flatMap((id) => input.live.cars[id] ?? []);
    inSessionBy.set(input, cars);
  }
  return cars;
};

/**
 * The cars in the session that have LapData in this frame: step 1 stamped their timing at the frame's time (C10: a
 * recorder reads the live state, not the frame).
 */
export const carsWithLapData = (input: Input): readonly LiveCar[] => {
  let cars = withLapDataBy.get(input);
  if (cars === undefined) {
    cars = carsInSession(input).filter((car) => car.updatedAt.lapData === input.at);
    withLapDataBy.set(input, cars);
  }
  return cars;
};
