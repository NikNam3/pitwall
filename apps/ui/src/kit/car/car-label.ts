import type { CarIdentity, UnknownReason } from '@pitwall/domain';
import { carCode } from './car-code.ts';

/** A car's code as a cell: the text, and why it is empty when the car is not in the field (for the hover). */
export type CarCodeCell = { text: string; reason?: UnknownReason };

/** A car's code looked up by id in a field; empty with `notReceived` when the car is not in it (no participant data yet). */
export function carCodeById(cars: readonly { id: number; identity: Pick<CarIdentity, 'name' | 'raceNumber'> }[], id: number): CarCodeCell {
  const car = cars.find((c) => c.id === id);
  return car ? { text: carCode(car.identity) } : { text: '', reason: 'notReceived' };
}
