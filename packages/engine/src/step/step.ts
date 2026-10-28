import type { Frame } from '../frame/frame.ts';
import type { EngineState } from '../state/engine-state.ts';
import { applyIdentity, isActiveCar } from './identity.ts';
import { applySession } from './session.ts';
import type { StepOutput, SubStep } from './types.ts';

export type { ChangeTag, LapCorrection, StepOutput, SubStep } from './types.ts';

/** Run in this order; a sub-step may rely on the ones before it. */
export const SUB_STEPS: SubStep[] = [applySession, applyIdentity];

const refreshActive = (state: EngineState): void => {
  for (const car of state.cars) {
    car.active = isActiveCar(car.id, state.session.numActiveCars, car.timing.resultStatus);
  }
};

/** Applies one frame to the state in place (spec 6.1). */
export function step(state: EngineState, frame: Frame): StepOutput {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  for (const subStep of SUB_STEPS) subStep(state, frame, out);
  if (out.changed.has('participants') || out.changed.has('timing')) refreshActive(state);
  state.lastFrameId = frame.frameId;
  state.sessionTime = frame.sessionTime;
  return out;
}
