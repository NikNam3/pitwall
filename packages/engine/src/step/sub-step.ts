import type { Frame } from '../frame/frame.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { StepOutput } from './types.ts';

/** One part of `step`: reads the frame, updates its part of the state and tags what it changed. */
export type SubStep = (state: EngineState, frame: Frame, out: StepOutput) => void;
