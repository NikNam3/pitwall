import type { EngineState } from '../state/engine-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { EngineView } from './types.ts';

/** The `activeFlagPhase` of the view for `state`: the open tracker's neutralised phase, copied so the view never aliases it. */
export const activeFlagPhaseOf = (state: DeepReadonly<EngineState>): EngineView['activeFlagPhase'] => {
  const phase = state.open.flagPhase;
  return phase && { ...phase, scPhases: [...phase.scPhases] };
};

/** The `situation` of the view for `state`: the tracker's open phase (replaced, never changed, on every change) and the pause flag. */
export const situationOf = (state: DeepReadonly<EngineState>): EngineView['situation'] => {
  const { session, paused } = state.open.situations;
  return { session, paused };
};
