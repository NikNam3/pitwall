import { clockPaused } from '../situations/clock/types.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { EngineView } from './types.ts';

/** The `situation` of the view for `state`: whether the game is paused (the clock's open span is `paused`). */
export const situationOf = (state: DeepReadonly<EngineState>): EngineView['situation'] => ({
  paused: clockPaused(state.open.clock),
});
