// The live state (contract C8): the current values of the session and of every car, no signal (C13). Protocol-free, so
// recorders, the view and the bridge can read it without reaching a packet type (C6).
import type { EngineState } from './engine-state.ts';

/**
 * Today's `EngineState` without its open trackers, its history, the weekend context (the view's own `weekend`, C39; no
 * recorder reads stored data, C10, C38), the signals (only the machine reads them, C13) and the log (C28). It holds the
 * frame's value events (`frameEvents`, written by step 1).
 */
export type LiveState = Omit<EngineState, 'open' | 'history' | 'weekend' | 'signals' | 'log'>;

/** A live-state area: the change tags of `CHANGE_TAGS` (`step/types.ts`) that are not history lists. */
export type LiveArea = 'session' | 'identity' | 'timing' | 'tyres' | 'energy' | 'condition' | 'dynamics' | 'ownCar';
