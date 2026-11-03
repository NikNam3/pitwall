// Step 1's module type (contract C8). The only step-type file that reaches the frame and the signals.
import type { Frame } from '../../frame/frame.ts';
import type { Signals } from '../../signals/types.ts';
import type { LiveState } from '../../state/live-state.ts';
import type { StepOutput } from '../types.ts';

/** A step-1 module: reads the frame, writes its part of the live state (values only) and the signals. */
export type StateUpdate = { id: string; apply(frame: Frame, live: LiveState, signals: Signals, out: StepOutput): void };
