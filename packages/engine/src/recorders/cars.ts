import type { CarState } from '@pitwall/domain';
import { CAR_STATUS, carsInSessionOf } from '../situations/car-status/in-session.ts';
import type { RecorderInput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** A car of the live state as a recorder reads it. */
export type LiveCar = DeepReadonly<CarState>;

/**
 * The cars in the session: those whose car-status span is not `absent`, read from the frame's situation (C10, C20), as
 * `step` worked them out once for the frame (`input.carsInSession`); car-status is the one decider (C43).
 */
export const carsInSession = (input: DeepReadonly<RecorderInput>): LiveCar[] =>
  (input.carsInSession ?? carsInSessionOf(input.situation.byMachine[CAR_STATUS])).flatMap((id) => input.live.cars[id] ?? []);

/**
 * The cars in the session that have LapData in this frame: step 1 stamped their timing at the frame's time (C10: a
 * recorder reads the live state, not the frame).
 */
export const carsWithLapData = (input: DeepReadonly<RecorderInput>): LiveCar[] => carsInSession(input).filter((car) => car.updatedAt.lapData === input.at);
