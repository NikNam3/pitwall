import type { EngineState } from '../state/engine-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { EngineView } from './types.ts';

/**
 * The `situation` of the view for `state`: the tracker's open phase (replaced, never changed, on every change) and
 * whether the game is paused (an online pause in progress).
 */
export const situationOf = (state: DeepReadonly<EngineState>): EngineView['situation'] => ({
  session: state.open.situations.session,
  paused: state.open.phaseBook.onlinePause !== undefined,
});
