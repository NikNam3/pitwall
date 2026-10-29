import { copyPlain, type DeepReadonly, type EngineView } from '@pitwall/engine';

/** The cars as a calculator sees them: every slot of the game, read-only. */
export type ViewCars = EngineView['state']['cars'];

/** The car slot a subscription asks for: `params.carId` must be an own integer property in `0 .. carCount - 1`. */
const carIdOf = (params: unknown, carCount: number): number | undefined => {
  if (typeof params !== 'object' || params === null || !Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && carId >= 0 && carId < carCount ? carId : undefined;
};

/**
 * A `select` for the `{ carId }` topics that read the engine's car slots: copies (`copyPlain`, the engine state is plain
 * data) what `pick` takes from the requested car, or gives `undefined` for params that do not name a car. Everything
 * but `carId` in the params is ignored; the params are never changed. For an output keyed by car id, see `selectCar`.
 */
export const selectCarSlot =
  <T>(pick: (car: ViewCars[number]) => DeepReadonly<NoInfer<T>>) =>
  (cars: ViewCars, params: object): T | undefined => {
    const carId = carIdOf(params, cars.length);
    const car = carId === undefined ? undefined : cars[carId];
    return car === undefined ? undefined : (copyPlain(pick(car)) as T);
  };
