// The machine's interfaces (contract C9, C14-C20): sub-machines turn signals and values into open and closed spans.
import type { FrameNumber, MachineId, Ms, OpenSpan, SessionTime, Span, SpanDeclaration, WeekendPhase, WeekendPhaseKind } from '@pitwall/domain';
import type { SignalKey, Signals } from '../signals/types.ts';
import type { LiveArea, LiveState } from '../state/live-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

export type { Situation } from './situation.ts';

/** What a sub-machine reads (C15): signals, live-state areas and the open spans of named upstream sub-machines. */
export type MachineInputs = { signals: readonly SignalKey[]; values: readonly LiveArea[]; upstream: readonly MachineId[] };
/**
 * A sub-machine's step: its new open state and the spans it closed. A span opens with `startFrame` the frame number it
 * opened on (`MachineInput.frameNumber`); step 2 sets `endFrame`, the frame it closed on, as it appends it (C26).
 */
export type MachineStep<Open> = { open: Open; closed: Array<Omit<Span, 'endFrame'>> };

/**
 * One registered part of the machine, a folder `situations/<id>/` (C15). `spans`: its span declaration in domain
 * (`domain/src/situations/<id>.ts`, `spans.machine === id`), which holds its one scope and its span kinds.
 */
export type SubMachine<Open> = {
  id: MachineId;
  appliesTo: 'all' | readonly WeekendPhaseKind[];
  spans: SpanDeclaration;
  inputs: MachineInputs;
  transitions: ReadonlyArray<readonly [from: string | 'none', to: string]>;
  init(): Open;
  /** The open spans of `open`, at most one per scope (the session, a car or a zone). */
  openSpans(open: Open): OpenSpan[];
  step(open: Open, input: DeepReadonly<MachineInput>): MachineStep<Open>;
};

/** Step 0's clock as the sub-machines see it: from step 0, not an upstream (the clock is not in the registry). */
export type ClockInput = { paused: boolean; offsetMs: Ms };

/**
 * A sub-machine reads signals, values and the live state only (C9): of the frame, just its race-clock time, its id and
 * its number (C26).
 */
export type MachineInput = {
  at: SessionTime;
  frameId: number;
  frameNumber: FrameNumber;
  signals: Signals;
  live: LiveState;
  clock: ClockInput;
  upstream: Record<MachineId, readonly OpenSpan[]>;
  weekendPhase: WeekendPhase;
};
