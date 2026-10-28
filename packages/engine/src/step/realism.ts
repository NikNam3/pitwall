import { unknown, type CarState } from '@pitwall/domain';
import { CORNER_NAMES } from './corners.ts';
import type { SubStep } from './types.ts';

/**
 * Sets the fields a real race engineer cannot see on a rival (research 06 section 5) to `unknown('realism')`: the one
 * list of them. Timing, compound, tyre age, position on track and speed traps stay.
 */
export const withholdForRealism = (car: CarState): void => {
  const hidden = unknown('realism');
  car.energy.fuel = hidden;
  car.energy.ers = hidden;
  car.energy.power = hidden;
  car.tyres.sets = hidden;
  car.condition.bodywork = hidden;
  car.condition.powerUnit = hidden;
  car.condition.drsFault = hidden;
  car.condition.engineTempC = hidden;
  for (const corner of CORNER_NAMES) {
    const tyre = car.tyres.corners[corner];
    tyre.surfaceTempC = hidden;
    tyre.carcassTempC = hidden;
    tyre.pressurePsi = hidden;
    tyre.wearPct = hidden;
    tyre.damagePct = hidden;
    tyre.blistersPct = hidden;
    car.condition.brakes[corner].tempC = hidden;
    car.condition.brakes[corner].damagePct = hidden;
  }
  car.dynamics = hidden;
};

/** With realism on, every car but the player's and the teammate's is masked, on every frame, so no later step or calculator sees the values. Adds no change tag. */
export const applyRealism: SubStep = (state) => {
  if (!state.realism) return;
  for (const car of state.cars) {
    if (car.id !== state.playerCar && car.id !== state.teammateCar) withholdForRealism(car);
  }
};
