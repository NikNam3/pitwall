import type { CarState } from '@pitwall/domain';
import type { DamageChangeParams } from '@pitwall/domain';
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

/**
 * Appends a `damageChange` event for every damage part that rose since the previous frame of the car (a fall, a repair,
 * is none). A car's first reading only sets the baseline. Returns whether an event was appended.
 */
export const applyDamageChanges = (state: EngineState, frame: Frame): boolean => {
  const previous = (state.open.damage ??= []);
  let appended = false;
  for (const car of state.cars) {
    const before = previous[car.id];
    const now: number[] = before ?? [];
    let complete = true;
    // a part that is unknown makes the frame no reading
    for (const [i, [part, read]] of PARTS.entries()) {
      const value = read(car);
      if (value === undefined) { complete = false; break; }
      const was = before?.[i];
      if (was !== undefined && value > was) {
        const params: DamageChangeParams = { part, fromPct: was, toPct: value };
        state.history.events.push({ at: frame.sessionTime, kind: 'damageChange', carId: car.id, params });
        appended = true;
      }
      now[i] = value;
    }
    if (complete) previous[car.id] = now;
  }
  return appended;
};
