// "Our cars": the one definition of whose cars the panel works for, shared by every analysis that picks them.
import type { CarId } from '@pitwall/domain';

/** Our cars: the player's, then the teammate's if there is one and it is a different car. */
export function ourCars(state: { playerCar: CarId; teammateCar?: CarId | undefined }): CarId[] {
  const { playerCar, teammateCar } = state;
  return teammateCar === undefined || teammateCar === playerCar ? [playerCar] : [playerCar, teammateCar];
}
