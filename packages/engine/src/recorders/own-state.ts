import type { EngineState } from '../state/engine-state.ts';
import type { Recorder } from '../step/types.ts';

/**
 * A recorder's own open state in the engine state. Only `step` and, until Task 9 moves the race start into the machine,
 * the situation tracker's formation discard and lights out (`history/situations/`) reach into it;
 * no recorder reads another's (C11).
 */
export const ownStateOf = <Own>(state: Pick<EngineState, 'open'>, recorder: Recorder<Own>): Own => state.open.recorders[recorder.id] as Own;
