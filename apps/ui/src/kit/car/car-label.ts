import type { CarIdentity } from '@pitwall/domain';
import { unknownPart, type CellPart } from '../grid/grid.ts';
import { carCode } from './car-code.ts';

/** A car's code looked up by id in a field as a part; unknown with `notReceived` when the car is not in it (no participant data yet). */
export function carCodeById(cars: readonly { id: number; identity: Pick<CarIdentity, 'name' | 'raceNumber'> }[], id: number): CellPart {
  const car = cars.find((c) => c.id === id);
  return car ? { text: carCode(car.identity) } : unknownPart('notReceived');
}
