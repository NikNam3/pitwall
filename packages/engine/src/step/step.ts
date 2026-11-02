import type { Frame } from '../frame/frame.ts';
import { applyEvents } from '../history/events.ts';
import { applyFlagPhases } from '../history/flags.ts';
import { applyLaps } from '../history/laps.ts';
import { applyMiniSectors } from '../history/mini-sectors.ts';
import { applyPitStops } from '../history/pit-stops.ts';
import { applySessionClock, applySituations } from '../history/situations/index.ts';
import { applyStints } from '../history/stints.ts';
import { ProjectionTracker } from '../log/projection.ts';
import { emptySituation } from '../situations/situation.ts';
import type { EngineState } from '../state/engine-state.ts';
import { applyCondition } from './condition.ts';
import { applyDynamics } from './dynamics.ts';
import { applyEnergy } from './energy.ts';
import { applyIdentity, isActiveCar, slotsInUse } from './identity.ts';
import { applyOwnCar } from './own-car.ts';
import { applyRealism } from './realism.ts';
import { applySession } from './session.ts';
import { applyTiming } from './timing.ts';
import { applyTyres } from './tyres.ts';
import type { FlashbackReport, StepOutput } from './types.ts';
import type { SubStep } from './sub-step.ts';

export {
  ALL_CHANGE_TAGS,
  CHANGE_TAGS,
  type ChangeTag,
  type ClockFall,
  type ClockJump,
  type FlashbackReport,
  type LapCorrection,
  type StepOutput,
} from './types.ts';
export type { SubStep } from './sub-step.ts';

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
  applyRealism,
  // The first history step: the others read the session phase it records.
  applySituations,
  applyPitStops,
  applyLaps,
  applyStints,
  applyFlagPhases,
  applyEvents,
  applyMiniSectors,
];

const refreshActive = (state: EngineState): void => {
  const slots = slotsInUse(state);
  for (const car of state.cars) {
    car.active = isActiveCar(car.id, slots, car.timing.resultStatus);
  }
};

/** The projection of the state's log, kept in the state (`history`, `open.projection`). */
export const projectionTrackerOf = (state: EngineState): ProjectionTracker =>
  new ProjectionTracker(state.log, { projection: state.history, book: state.open.projection });

/**
 * Applies one frame to the state in place (spec 6.1). The situation tracker reads the session time's jump first, and
 * every sub-step stamps with the frame's time on its race clock (spec 3.3). `report`: the `SessionRunner` took the
 * frame as a flashback report. Last, the projection takes in what the frame appended; a step that rewrote the log in
 * place (`rewritten`) projects it again. Until the machine runs (Task 5) no span is open, so nothing is hidden by a stamp.
 */
export function step(state: EngineState, received: Frame, report?: FlashbackReport): StepOutput {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  const frame = applySessionClock(state, received, out, report);
  for (const subStep of SUB_STEPS) subStep(state, frame, out);
  if (out.changed.has('identity') || out.changed.has('timing')) refreshActive(state);
  const projection = projectionTrackerOf(state);
  if (out.rewritten) projection.rebuild(emptySituation());
  else projection.update(emptySituation());
  state.lastFrameId = frame.frameId;
  state.sessionTime = frame.sessionTime;
  return out;
}
