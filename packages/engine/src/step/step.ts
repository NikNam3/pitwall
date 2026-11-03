import type { Frame } from '../frame/frame.ts';
import { applyFlagPhases } from '../history/flags.ts';
import { applySimulatedEnd, applySituations } from '../history/situations/index.ts';
import { logWriter } from '../log/log.ts';
import { ProjectionTracker } from '../log/projection.ts';
import { eventsRecorder } from '../recorders/events.ts';
import { lapsRecorder } from '../recorders/laps.ts';
import { miniSectorsRecorder } from '../recorders/mini-sectors.ts';
import { pitStopsRecorder } from '../recorders/pit-stops.ts';
import { stintsRecorder } from '../recorders/stints.ts';
import { readSignals } from '../signals/read.ts';
import { STEP0_CLOCK, type ClockStep } from '../situations/clock/clock.ts';
import { runMachine, situationOf } from '../situations/run.ts';
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
import type { FlashbackReport, FrameStamps, Recorder, RecorderInput, StepOutput } from './types.ts';

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

/**
 * Step 0 (C7): the clock reads the session time's jump and returns the frame on the race clock with its clock facts;
 * `report`: the `SessionRunner` took the frame as a flashback report. Every fall is reported as `clockFall` and every
 * other forward jump as `clockJump`, with the game's times; the simulated end opens the post-session (C36).
 */
const step0Clock = (state: EngineState, received: Frame, report: FlashbackReport | undefined, out: StepOutput): ClockStep => {
  const clock = STEP0_CLOCK.step(state.open.clock, { frame: received, report, lastRaceMs: state.sessionTime, networkGame: state.session.networkGame });
  state.open.clock = clock.open;
  for (const fact of clock.facts) {
    if (fact.kind === 'fall') out.clockFall = { fromMs: fact.fromMs, toMs: fact.toMs };
    else if (fact.kind === 'jump') out.clockJump = { fromMs: fact.fromMs, toMs: fact.toMs };
    else applySimulatedEnd(state, out);
  }
  return clock;
};

/** Appends step 0's clock facts to `clock` and its closed paused span to `spans:clock`, stamped with the frame's session spans (C26). */
const appendClock = (state: EngineState, clock: ClockStep, stamps: FrameStamps): void => {
  const log = logWriter(state.log);
  for (const fact of clock.facts) log.append('clock', { ...fact, in: stamps.session });
  for (const span of clock.closed) log.append(`spans:${STEP0_CLOCK.id}`, { ...span, in: stamps.session });
};

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
 * Applies one frame to the state in place (spec 6.1, C7-C10), in four steps: step 0, the clock (`step0Clock`: the frame
 * on the race clock and its clock facts, appended after step 2 with the frame's stamps); step 1, the state update;
 * step 2, the machine (`runMachine`: the registered sub-machines, their closed spans and the frame's stamps), after the
 * situation tracker and the flag phases it mirrors, which keep step 2's slot until Tasks 9/19 port them (the tracker
 * also decides `tracked`, what the frame's situation events tell the recorders); step 3, the recorders, with the stamps and the machine's situation. Last, the projection takes in
 * what the frame appended, resolving stamps with the open spans; a step that rewrote the log in place (`rewritten`, the
 * legacy formation discard until Task 9) projects it again.
 */
export function step(state: EngineState, received: Frame, report?: FlashbackReport): StepOutput {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  const clock = step0Clock(state, received, report, out);
  const { frame } = clock;
  updateState(state, frame, out);
  applySituations(state, frame, out);
  applyFlagPhases(state, out);
  const stamps = runMachine(state, frame, out);
  appendClock(state, clock, stamps);
  const situation = situationOf(state);
  const tracked = trackedEventsOf(state.signals.events);
  record(state, { at: frame.sessionTime, frameId: frame.frameId, live: state, situation, stamps, tracked }, out);
  const projection = projectionTrackerOf(state);
  if (out.rewritten) projection.rebuild(situation);
  else projection.update(situation);
  state.lastFrameId = frame.frameId;
  state.sessionTime = frame.sessionTime;
  return out;
}
