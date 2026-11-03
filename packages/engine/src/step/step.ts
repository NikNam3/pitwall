import type { Frame } from '../frame/frame.ts';
import { applyFlagPhases } from '../history/flags.ts';
import { applySessionClock, applySituations } from '../history/situations/index.ts';
import { logWriter } from '../log/log.ts';
import { ProjectionTracker } from '../log/projection.ts';
import { eventsRecorder } from '../recorders/events.ts';
import { lapsRecorder } from '../recorders/laps.ts';
import { miniSectorsRecorder } from '../recorders/mini-sectors.ts';
import { pitStopsRecorder } from '../recorders/pit-stops.ts';
import { stintsRecorder } from '../recorders/stints.ts';
import { readSignals } from '../signals/read.ts';
import { emptySituation } from '../situations/situation.ts';
import { trackedEventsOf } from '../situations/tracked-events.ts';
import type { EngineState } from '../state/engine-state.ts';
import { conditionUpdate } from './state-update/condition.ts';
import { dynamicsUpdate } from './state-update/dynamics.ts';
import { energyUpdate } from './state-update/energy.ts';
import { frameEventsUpdate } from './state-update/frame-events.ts';
import { identityUpdate } from './state-update/identity.ts';
import { ownCarUpdate } from './state-update/own-car.ts';
import { sessionUpdate } from './state-update/session.ts';
import { refreshActiveCarsUntilCarStatus } from './state-update/active-cars-until-car-status.ts';
import { timingUpdate } from './state-update/timing.ts';
import type { StateUpdate } from './state-update/types.ts';
import { tyresUpdate } from './state-update/tyres.ts';
import type { FlashbackReport, Recorder, RecorderInput, StepOutput } from './types.ts';

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

/** Step 1's modules (C8): each reads the frame and writes its part of the live state; in any order (C11). */
export const STATE_UPDATE: StateUpdate[] = [
  sessionUpdate,
  identityUpdate,
  timingUpdate,
  tyresUpdate,
  energyUpdate,
  conditionUpdate,
  dynamicsUpdate,
  ownCarUpdate,
  frameEventsUpdate,
];

/** Step 3's modules (C10): each reads the live state, the situations and its own open state, and appends facts; in any order (C11). */
export const RECORDERS: Array<Recorder<unknown>> = [
  lapsRecorder,
  pitStopsRecorder,
  stintsRecorder,
  eventsRecorder,
  miniSectorsRecorder,
];

/** The projection of the state's log, kept in the state (`history`, `open.projection`). */
export const projectionTrackerOf = (state: EngineState): ProjectionTracker =>
  new ProjectionTracker(state.log, { projection: state.history, book: state.open.projection });

/**
 * Step 1 (C8): whom realism masks (the previous frame's player and teammate), the signals, then every module; last the
 * transitional `active` refresh (until Task 10).
 */
const updateState = (state: EngineState, frame: Frame, out: StepOutput): void => {
  state.masking = { player: state.playerCar, teammate: state.teammateCar, realism: state.realism };
  state.signals = readSignals(frame, state.signals);
  for (const update of STATE_UPDATE) update.apply(frame, state, state.signals, out);
  refreshActiveCarsUntilCarStatus(state, out);
};

/** Step 3 (C10): every recorder with this frame's input and its own open state. */
const record = (state: EngineState, input: RecorderInput, out: StepOutput): void => {
  const log = logWriter(state.log);
  for (const recorder of RECORDERS) state.open.recorders[recorder.id] = recorder.apply(input, state.open.recorders[recorder.id], log, out);
};

/**
 * Applies one frame to the state in place (spec 6.1, C7-C10), in four steps: step 0, the clock (the situation tracker
 * reads the session time's jump and returns the frame on the race clock, `report`: the `SessionRunner` took the frame
 * as a flashback report); step 1, the state update; step 2, the machine's slot (until the machine runs, Task 5: the
 * situation tracker and the flag phases it mirrors; it also decides `tracked`, what the frame's situation events tell
 * the recorders); step 3, the recorders. Last, the projection takes in what the frame appended; a step that rewrote the
 * log in place (`rewritten`) projects it again. Until the machine runs no span is open, so nothing is hidden by a stamp.
 */
export function step(state: EngineState, received: Frame, report?: FlashbackReport): StepOutput {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  const frame = applySessionClock(state, received, out, report);
  updateState(state, frame, out);
  applySituations(state, frame, out);
  applyFlagPhases(state, out);
  const situation = emptySituation();
  const tracked = trackedEventsOf(state.signals.events);
  record(state, { at: frame.sessionTime, frameId: frame.frameId, live: state, situation, stamps: { session: {}, cars: [] }, tracked }, out);
  const projection = projectionTrackerOf(state);
  if (out.rewritten) projection.rebuild(situation);
  else projection.update(situation);
  state.lastFrameId = frame.frameId;
  state.sessionTime = frame.sessionTime;
  return out;
}
