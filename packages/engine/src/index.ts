// The engine's main entry: the readers' view (`readers.ts`, also `@pitwall/engine/readers`) and the adapter side, which
// knows the game (frames, `step`, the runner; C6).
export * from './readers.ts';
export { FrameAssembler } from './frame/assembler.ts';
export { MENU_RATE_SLOTS, type Frame } from './frame/frame.ts';
export { SessionTracker, type TrackerEvent } from './frame/session-tracker.ts';
export { Scheduler } from './calc/scheduler.ts';
export { initialState } from './step/state-update/initial.ts';
export { participantsValuesOf } from './step/state-update/identity.ts';
export { step, type FlashbackReport } from './step/step.ts';
export {
  IDENTITY_WAIT_FRAMES,
  SessionRunner,
  type FlashbackInfo,
  type OnResult,
  type SessionRunnerOptions,
  type Snapshotable,
  type StepResult,
} from './runner/session-runner.ts';
// The registered sub-machines, step 0's clock and their type, for tools that read the machine's spans on their own
// (`pitwall scan-situations`).
export { MACHINES } from './situations/index.generated.ts';
// The view's situation of a state (C20, C39): the bridge's scheduler inputs and tools that read the open spans.
export { situationOf } from './situations/run.ts';
export { STEP0_CLOCK } from './situations/clock/clock.ts';
export type { SubMachine } from './situations/machine.ts';
