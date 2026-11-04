// Edits of one frame's input for the car sub-machines' tests (contract C12): a car's signals and the PENA events the game
// sends. Built on `InputEdit` (`transition-table.ts`); `all` runs several edits on one frame.
import { carId } from '@pitwall/domain';
import type { CarSignals, SituationEvent } from '../../src/signals/types.ts';
import type { InputEdit } from './transition-table.ts';

/** A PENA event for `car` (`otherCar`: the other car of a collision); `timeMs` stays `undefined` (the game's 255). */
export const pena = (car: number, penaltyType: number, infringementType: number, otherCar?: number): Extract<SituationEvent, { code: 'PENA' }> => ({
  code: 'PENA',
  carId: carId(car),
  otherCarId: otherCar === undefined ? undefined : carId(otherCar),
  penaltyType,
  infringementType,
  timeMs: undefined,
  lap: 1,
  placesGained: 0,
});

/** Sets signals of one car; they hold on the frames after it (the builder carries a frame's signals on). */
export const car = (index: number, patch: Partial<CarSignals>): InputEdit => (input) => {
  Object.assign(input.signals.cars[index]!, patch);
};

/** Adds events to the frame (the builder clears them for the next one). */
export const events = (...list: SituationEvent[]): InputEdit => (input) => {
  input.signals.events.push(...list);
};

/** Several edits on one frame. */
export const all = (...edits: InputEdit[]): InputEdit => (input, index) => {
  for (const edit of edits) edit(input, index);
};

/**
 * The frame carries Participants data for every slot, unless an earlier frame did: each car's `updatedAt.participants`
 * (a value of the identity area, C8) set to the frame's time. Until then nobody knows whether a slot holds a car (C3).
 */
export const participants: InputEdit = (input) => {
  for (const c of input.live.cars) c.updatedAt.participants ??= input.at;
};
