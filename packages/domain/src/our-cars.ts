// "Our cars": the one definition of whose cars the panel works for, shared by every reader that picks them (C43).
import type { CarId } from './ids.ts';

/** Our cars: the player's, then the teammate's if there is one and it is a different car. */
export function ourCars(cars: { playerCar: CarId; teammateCar?: CarId | undefined }): CarId[] {
  const { playerCar, teammateCar } = cars;
  return teammateCar === undefined || teammateCar === playerCar ? [playerCar] : [playerCar, teammateCar];
}
