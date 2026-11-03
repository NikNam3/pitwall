import { copyPlain, type DeepReadonly } from '@pitwall/engine/readers';
import type { LiveView } from './feature.ts';

/** One car slot of the live state, read-only. */
type LiveCar = LiveView['cars'][number];

/** The car slot a subscription asks for: `params.carId` must be an own integer property in `0 .. carCount - 1`. */
const carIdOf = (params: unknown, carCount: number): number | undefined => {
  if (typeof params !== 'object' || params === null || !Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && carId >= 0 && carId < carCount ? carId : undefined;
};

/**
 * A `bindLive` select for the `{ carId }` topics that read the live state's car slots: copies (`copyPlain`, the engine
 * state is plain data and changes in place) only what `pick` takes from the requested car, or gives `undefined` for
 * params that do not name a car. Everything but `carId` in the params is ignored; the params are never changed. For a
 * calculator output keyed by car id, see `selectCar`.
 */
export const selectCarSlot =
  <T>(pick: (car: LiveCar) => DeepReadonly<NoInfer<T>>) =>
  (live: LiveView, params: object): T | undefined => {
    const carId = carIdOf(params, live.cars.length);
    const car = carId === undefined ? undefined : live.cars[carId];
    return car === undefined ? undefined : (copyPlain(pick(car)) as T);
  };
