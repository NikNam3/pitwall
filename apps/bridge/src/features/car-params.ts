import type { EngineView } from '@pitwall/engine';

/** The cars as a calculator sees them: every slot of the game, read-only. */
export type ViewCars = EngineView['state']['cars'];

/** The car slot a subscription asks for: `params.carId` must be an own integer property in `0 .. carCount - 1`. */
const carIdOf = (params: unknown, carCount: number): number | undefined => {
  if (typeof params !== 'object' || params === null || !Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && carId >= 0 && carId < carCount ? carId : undefined;
};

/**
 * A `select` for the `{ carId }` topics: clones what `pick` takes from the requested car, or gives `undefined`
 * for params that do not name a car. Everything but `carId` in the params is ignored; the params are never changed.
 */
export const selectCar =
  <T>(pick: (car: ViewCars[number]) => T) =>
  (cars: unknown, params: object): T | undefined => {
    const list = cars as ViewCars;
    const carId = carIdOf(params, list.length);
    const car = carId === undefined ? undefined : list[carId];
    return car === undefined ? undefined : structuredClone(pick(car));
  };
