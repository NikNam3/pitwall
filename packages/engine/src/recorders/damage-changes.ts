import type { DamageChangeParams } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import { stampOf, type RecorderInput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { LiveCar } from './cars.ts';

/** The eight damage parts in the order of the stored previous readings. */
const PARTS = [
  ['frontLeftWingPct', (car: LiveCar) => car.condition.bodywork.known ? car.condition.bodywork.value.frontLeftWingPct : undefined],
  ['frontRightWingPct', (car: LiveCar) => car.condition.bodywork.known ? car.condition.bodywork.value.frontRightWingPct : undefined],
  ['rearWingPct', (car: LiveCar) => car.condition.bodywork.known ? car.condition.bodywork.value.rearWingPct : undefined],
  ['floorPct', (car: LiveCar) => car.condition.bodywork.known ? car.condition.bodywork.value.floorPct : undefined],
  ['diffuserPct', (car: LiveCar) => car.condition.bodywork.known ? car.condition.bodywork.value.diffuserPct : undefined],
  ['sidepodPct', (car: LiveCar) => car.condition.bodywork.known ? car.condition.bodywork.value.sidepodPct : undefined],
  ['gearboxPct', (car: LiveCar) => car.condition.powerUnit.known ? car.condition.powerUnit.value.gearboxDamagePct : undefined],
  ['enginePct', (car: LiveCar) => car.condition.powerUnit.known ? car.condition.powerUnit.value.engineDamagePct : undefined],
] as const satisfies ReadonlyArray<readonly [DamageChangeParams['part'], (car: LiveCar) => number | undefined]>;

/** Per car: the eight damage percentages of the previous reading (`PARTS` order); for `damageChange` events. */
export type DamageReadings = Array<number[] | undefined>;

/** The car's eight damage percentages in `PARTS` order, or `undefined` when any part is unknown (no reading). */
const readingOf = (car: LiveCar): number[] | undefined => {
  const reading: number[] = [];
  for (const [, read] of PARTS) {
    const value = read(car);
    if (value === undefined) return undefined;
    reading.push(value);
  }
  return reading;
};

/**
 * Appends a `damageChange` event for every damage part that changed since the car's previous reading: a rise is a hit,
 * a fall a repair. A car's first reading only sets the baseline; one where any part is unknown is no reading. Only Car
 * Damage changes the condition, so a car whose condition step 1 did not update at this frame's time is skipped.
 * Returns whether it appended an event.
 */
export const recordDamageChanges = (input: DeepReadonly<RecorderInput>, previous: DamageReadings, log: LogWriter): boolean => {
  const { at } = input;
  let appended = false;
  for (const car of input.live.cars) {
    if (car.updatedAt.damage !== at) continue;
    const now = readingOf(car);
    if (now === undefined) continue;
    const before = previous[car.id];
    if (before !== undefined) {
      let i = 0;
      for (const [part] of PARTS) {
        const was = before[i];
        const value = now[i];
        i++;
        if (was === undefined || value === undefined || value === was) continue;
        const params: DamageChangeParams = { part, fromPct: was, toPct: value };
        log.append('events', { at, kind: 'damageChange', carId: car.id, params, in: stampOf(input.stamps, car.id) });
        appended = true;
      }
    }
    previous[car.id] = now;
  }
  return appended;
};
