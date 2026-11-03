import { unknown, type CarState } from '@pitwall/domain';
import type { LiveState } from '../../state/live-state.ts';
import { CORNER_NAMES } from '../corners.ts';

/** The step-1 modules whose fields realism hides on a rival. */
export type RealismArea = 'energy' | 'tyres' | 'condition' | 'dynamics';

/**
 * The fields a real race engineer cannot see on a rival (research 06 section 5), by the module that writes them: the
 * one list of them. Timing, compound, tyre age, position on track and speed traps stay.
 */
const HIDDEN: Record<RealismArea, (car: CarState) => void> = {
  energy: (car) => {
    const hidden = unknown('realism');
    car.energy.fuel = hidden;
    car.energy.ers = hidden;
    car.energy.power = hidden;
  },
  tyres: (car) => {
    const hidden = unknown('realism');
    car.tyres.sets = hidden;
    for (const corner of CORNER_NAMES) {
      const tyre = car.tyres.corners[corner];
      tyre.surfaceTempC = hidden;
      tyre.carcassTempC = hidden;
      tyre.pressurePsi = hidden;
      tyre.wearPct = hidden;
      tyre.damagePct = hidden;
      tyre.blistersPct = hidden;
    }
  },
  condition: (car) => {
    const hidden = unknown('realism');
    car.condition.bodywork = hidden;
    car.condition.powerUnit = hidden;
    car.condition.drsFault = hidden;
    car.condition.engineTempC = hidden;
    for (const corner of CORNER_NAMES) {
      car.condition.brakes[corner].tempC = hidden;
      car.condition.brakes[corner].damagePct = hidden;
    }
  },
  dynamics: (car) => {
    car.dynamics = unknown('realism');
  },
};

const AREAS = Object.keys(HIDDEN) as RealismArea[];

/** Sets every field realism hides on a rival to `unknown('realism')`. */
export const withholdForRealism = (car: CarState): void => {
  for (const area of AREAS) HIDDEN[area](car);
};

/**
 * Whether realism hides the car's values: realism is on and the car is neither the player's nor the teammate's, as the
 * previous frame left them (`live.masking`; C11: the identity module changes them during the frame).
 */
export const hiddenByRealism = (live: LiveState, car: CarState): boolean =>
  live.masking.realism && car.id !== live.masking.player && car.id !== live.masking.teammate;

/**
 * Realism in step 1 (C8): each module masks its own fields of every rival, on every frame, so no later step or
 * calculator sees them. Adds no change tag.
 */
export const maskForRealism = (live: LiveState, area: RealismArea): void => {
  if (!live.masking.realism) return;
  for (const car of live.cars) if (hiddenByRealism(live, car)) HIDDEN[area](car);
};

/** A car's realism masks after another write to it (the identity module's restricted wipe): every area, if realism hides it. */
export const maskCarForRealism = (live: LiveState, car: CarState): void => {
  if (hiddenByRealism(live, car)) withholdForRealism(car);
};
