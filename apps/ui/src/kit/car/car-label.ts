import type { CarIdentity } from '@pitwall/domain';
import { carCode } from './car-code.ts';

/** A car's code looked up by id in a field; `#<id>` when the car is not in it. */
export function carCodeById(cars: readonly { id: number; identity: Pick<CarIdentity, 'name' | 'raceNumber'> }[], id: number): string {
  const car = cars.find((c) => c.id === id);
  return car ? carCode(car.identity) : `#${id}`;
}
