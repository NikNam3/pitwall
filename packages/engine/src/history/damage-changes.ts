import type { CarState, DamageChangeParams } from '@pitwall/domain';
import type { EngineState } from '../state/engine-state.ts';
import type { Frame } from '../frame/frame.ts';

/** The eight damage parts in the order of the stored previous readings. */
const PARTS = [
  ['frontLeftWingPct', (car: CarState) => car.condition.bodywork.known ? car.condition.bodywork.value.frontLeftWingPct : undefined],
  ['frontRightWingPct', (car: CarState) => car.condition.bodywork.known ? car.condition.bodywork.value.frontRightWingPct : undefined],
  ['rearWingPct', (car: CarState) => car.condition.bodywork.known ? car.condition.bodywork.value.rearWingPct : undefined],
  ['floorPct', (car: CarState) => car.condition.bodywork.known ? car.condition.bodywork.value.floorPct : undefined],
  ['diffuserPct', (car: CarState) => car.condition.bodywork.known ? car.condition.bodywork.value.diffuserPct : undefined],
  ['sidepodPct', (car: CarState) => car.condition.bodywork.known ? car.condition.bodywork.value.sidepodPct : undefined],
  ['gearboxPct', (car: CarState) => car.condition.powerUnit.known ? car.condition.powerUnit.value.gearboxDamagePct : undefined],
  ['enginePct', (car: CarState) => car.condition.powerUnit.known ? car.condition.powerUnit.value.engineDamagePct : undefined],
] as const satisfies ReadonlyArray<readonly [DamageChangeParams['part'], (car: CarState) => number | undefined]>;

/** The car's eight damage percentages in `PARTS` order, or `undefined` when any part is unknown (no reading). */
const readingOf = (car: CarState): number[] | undefined => {
  const reading: number[] = [];
  for (const [, read] of PARTS) {
    const value = read(car);
    if (value === undefined) return undefined;
    reading.push(value);
  }
  return reading;
};

/**
 * Appends a `damageChange` event for every damage part that rose since the car's previous reading (a fall, a repair,
 * is none). A car's first reading only sets the baseline; a frame where any part is unknown is no reading. Only Car
 * Damage changes the condition, so a frame without it is skipped.
 */
export const applyDamageChanges = (state: EngineState, frame: Frame): void => {
  if (!frame.damage) return;
  const previous = state.open.damage;
  for (const car of state.cars) {
    const now = readingOf(car);
    if (now === undefined) continue;
    const before = previous[car.id];
    if (before !== undefined) {
      let i = 0;
      for (const [part] of PARTS) {
        const was = before[i];
        const value = now[i];
        i++;
        if (was === undefined || value === undefined || value <= was) continue;
        const params: DamageChangeParams = { part, fromPct: was, toPct: value };
        state.history.events.push({ at: frame.sessionTime, kind: 'damageChange', carId: car.id, params });
      }
    }
    previous[car.id] = now;
  }
};
