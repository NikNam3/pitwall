import type { Frame } from '../frame/frame.ts';
import { logWriter } from '../log/log.ts';
import { ProjectionTracker } from '../log/projection.ts';
import { decisionsRecorder } from '../recorders/decisions.ts';
import { eventsRecorder } from '../recorders/events.ts';
import { lapsRecorder } from '../recorders/laps.ts';
import { miniSectorsRecorder } from '../recorders/mini-sectors.ts';
import { penaltiesRecorder } from '../recorders/penalties.ts';
import { pitStopsRecorder } from '../recorders/pit-stops.ts';
import { stintsRecorder } from '../recorders/stints.ts';
import { readSignals } from '../signals/read.ts';
import { CAR_STATUS, carsInSessionOf } from '../situations/car-status/in-session.ts';
import { STEP0_CLOCK, type ClockStep } from '../situations/clock/clock.ts';
import { runMachine, samePlain, situationOf } from '../situations/run.ts';
import type { EngineState } from '../state/engine-state.ts';
import { conditionUpdate } from './state-update/condition.ts';
import { dynamicsUpdate } from './state-update/dynamics.ts';
import { energyUpdate } from './state-update/energy.ts';
import { frameEventsUpdate } from './state-update/frame-events.ts';
import { identityUpdate } from './state-update/identity.ts';
import { ownCarUpdate } from './state-update/own-car.ts';
import { sessionUpdate } from './state-update/session.ts';
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

/**
 * Step 0 (C7): the clock reads the session time's jump and returns the frame on the race clock with its clock facts;
 * `report`: the `SessionRunner` took the frame as a flashback report. Every fall is reported as `clockFall` and every
 * other forward jump as `clockJump`, with the game's times; the simulated end reaches the sub-machines as
 * `MachineInput.clock.simulatedEnd` (C36). The clock
 * facts describe the frame's number and its spans open and close on it (C26). Its tags follow step 2's rule (C40):
 * `clock` when it appends a clock fact, `spans:clock` when its open spans changed or it closed a span.
 */
const step0Clock = (state: EngineState, received: Frame, report: FlashbackReport | undefined, out: StepOutput): ClockStep => {
  const before = STEP0_CLOCK.openSpans(state.open.clock);
  const clock = STEP0_CLOCK.step(state.open.clock, {
    frame: received,
    report,
    lastRaceMs: state.sessionTime,
    networkGame: state.session.networkGame,
    frameNumber: state.frameNumber,
  });
  state.open.clock = clock.open;
  if (clock.facts.length > 0) out.changed.add('clock');
  if (clock.closed.length > 0 || !samePlain(before, STEP0_CLOCK.openSpans(clock.open))) out.changed.add('spans:clock');
  for (const fact of clock.facts) {
    if (fact.kind === 'fall') out.clockFall = { fromMs: fact.fromMs, toMs: fact.toMs };
    else if (fact.kind === 'jump') out.clockJump = { fromMs: fact.fromMs, toMs: fact.toMs };
  }
  return clock;
};

/** Appends step 0's clock facts to `clock` and its closed spans to `spans:clock` (C22). */
const appendClock = (state: EngineState, clock: ClockStep): void => {
  const log = logWriter(state.log);
  for (const fact of clock.facts) log.append('clock', fact);
  for (const span of clock.closed) log.append(`spans:${STEP0_CLOCK.id}`, span);
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
  penaltiesRecorder,
  decisionsRecorder,
];

/** The projection of the state's log, kept in the state (`history`, `open.projection`). */
export const projectionTrackerOf = (state: EngineState): ProjectionTracker =>
  new ProjectionTracker(state.log, { projection: state.history, book: state.open.projection });

/** Step 1 (C8): whom realism masks (the previous frame's player and teammate), the signals, then every module. */
const updateState = (state: EngineState, frame: Frame, out: StepOutput): void => {
  state.masking = { player: state.playerCar, teammate: state.teammateCar, realism: state.realism };
  state.signals = readSignals(frame, state.signals);
  for (const update of STATE_UPDATE) update.apply(frame, state, state.signals, out);
};

/** Step 3 (C10): every recorder with this frame's input and its own open state. */
const record = (state: EngineState, input: RecorderInput, out: StepOutput): void => {
  const log = logWriter(state.log);
  for (const recorder of RECORDERS) state.open.recorders[recorder.id] = recorder.apply(input, state.open.recorders[recorder.id], log, out);
};

/**
 * Applies one frame to the state in place (spec 6.1, C7-C10). First it counts the frame (`frameNumber`, C26): every
 * step of frame N sees `state.frameNumber` N, and each fact records the frame it describes, each span the frames it
 * opened and closed on. Then four steps: step 0, the clock (`step0Clock`: the frame on the race clock and its clock
 * facts, appended after step 2); step 1, the state update; step 2, the machine (`runMachine`: the registered
 * sub-machines, with step 0's clock, and their closed spans); step 3, the recorders, with the frame's number, the
 * machine's situation (its open spans and the spans it closed on the frame) and the cars in the session it gives,
 * worked out once for the frame, and `decisions`, the ones the user committed with the frame (C10, C76). Last the
 * projection takes in what the frame appended, computing membership from frame numbers with the open spans.
 */
export function step(state: EngineState, received: Frame, report?: FlashbackReport, decisions?: RecorderInput['decisions']): StepOutput {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  state.frameNumber += 1;
  const clock = step0Clock(state, received, report, out);
  const { frame } = clock;
  updateState(state, frame, out);
  const closed = runMachine(state, frame, out, clock.facts);
  appendClock(state, clock);
  const situation = situationOf(state);
  const carsInSession = carsInSessionOf(situation.byMachine[CAR_STATUS]);
  record(
    state,
    { at: frame.sessionTime, frameId: frame.frameId, frameNumber: state.frameNumber, live: state, situation, closed, carsInSession, ...(decisions && { decisions }) },
    out,
  );
  projectionTrackerOf(state).update(situation, state.frameNumber);
  state.lastFrameId = frame.frameId;
  state.sessionTime = frame.sessionTime;
  return out;
}
