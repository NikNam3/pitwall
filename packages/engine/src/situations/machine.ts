// The machine's interfaces (contract C9, C14-C20): sub-machines turn signals and values into open and closed spans.
import type { FrameEvent, MachineId, Ms, OpenSpan, Scope, Span, WeekendPhase, WeekendPhaseKind } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import type { SignalKey, Signals } from '../signals/types.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/**
 * The live state (C8): the current values of the session and of every car, no signal. Today's `EngineState` without its
 * open trackers and history, plus the frame's value events (`FrameEvent`, written by step 1), so no recorder reads a packet (C6).
 */
export type LiveState = Omit<EngineState, 'open' | 'history'> & { frameEvents: FrameEvent[] };

/** A live-state area: the change tags of `CHANGE_TAGS` (`step/types.ts`) that are not history lists. */
export type LiveArea = 'session' | 'identity' | 'timing' | 'tyres' | 'energy' | 'condition' | 'dynamics' | 'ownCar';

/** A frame whose `sessionTime` is already on the race clock (C35): step 0's output. */
export type FrameOnClock = Frame;

/** What a sub-machine reads (C15): signals, live-state areas and the open spans of named upstream sub-machines. */
export type MachineInputs = { signals: readonly SignalKey[]; values: readonly LiveArea[]; upstream: readonly MachineId[] };
/** A sub-machine's step: its new open state and the spans it closed. */
export type MachineStep<Open> = { open: Open; closed: Span[] };

/** One registered part of the machine, a folder `situations/<id>/` (C15). */
export type SubMachine<Open> = {
  id: MachineId;
  appliesTo: 'all' | readonly WeekendPhaseKind[];
  scope: Scope;
  inputs: MachineInputs;
  transitions: ReadonlyArray<readonly [from: string | 'none', to: string]>;
  init(): Open;
  openSpans(open: Open): OpenSpan[];
  step(open: Open, input: DeepReadonly<MachineInput>): MachineStep<Open>;
};

/** Step 0's clock as the sub-machines see it: from step 0, not an upstream (the clock is not in the registry). */
export type ClockInput = { paused: boolean; offsetMs: Ms };

export type MachineInput = {
  frame: FrameOnClock;
  signals: Signals;
  live: LiveState;
  clock: ClockInput;
  upstream: Record<MachineId, readonly OpenSpan[]>;
  weekendPhase: WeekendPhase;
};

/** The machine's open spans as readers see them (C20); the clock's open `paused` span is `byMachine.clock`. */
export type Situation = DeepReadonly<{ weekendPhase: WeekendPhase; session: OpenSpan | undefined; byMachine: Record<MachineId, OpenSpan[]> }>;
