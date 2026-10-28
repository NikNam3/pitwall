import type { Frame } from '../frame/frame.ts';
import { applyEvents } from '../history/events.ts';
import { applyFlagPhases } from '../history/flags.ts';
import { applyLaps } from '../history/laps.ts';
import { applyMiniSectors } from '../history/mini-sectors.ts';
import { applyPitStops } from '../history/pit-stops.ts';
import { applyStints } from '../history/stints.ts';
import type { EngineState } from '../state/engine-state.ts';
import { applyCondition } from './condition.ts';
import { applyDynamics } from './dynamics.ts';
import { applyEnergy } from './energy.ts';
import { applyIdentity, isActiveCar } from './identity.ts';
import { applyOwnCar } from './own-car.ts';
import { applySession } from './session.ts';
import { applyTiming } from './timing.ts';
import { applyTyres } from './tyres.ts';
import type { StepOutput, SubStep } from './types.ts';

export { ALL_CHANGE_TAGS, CHANGE_TAGS, type ChangeTag, type LapCorrection, type StepOutput, type SubStep } from './types.ts';

/** Run in this order; a sub-step may rely on the ones before it. */
export const SUB_STEPS: SubStep[] = [
  applySession,
  applyIdentity,
  applyTiming,
  applyTyres,
  applyEnergy,
  applyCondition,
  applyDynamics,
  applyOwnCar,
  applyPitStops,
  applyLaps,
  applyStints,
  applyFlagPhases,
  applyEvents,
  applyMiniSectors,
];

const refreshActive = (state: EngineState): void => {
  for (const car of state.cars) {
    car.active = isActiveCar(car.id, state.session.numActiveCars, car.timing.resultStatus);
  }
};

/** Applies one frame to the state in place (spec 6.1). */
export function step(state: EngineState, frame: Frame): StepOutput {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  for (const subStep of SUB_STEPS) subStep(state, frame, out);
  if (out.changed.has('identity') || out.changed.has('timing')) refreshActive(state);
  state.lastFrameId = frame.frameId;
  state.sessionTime = frame.sessionTime;
  return out;
}
